import { buildIndexes } from '../data/indexes.js';
import { personName } from './graph.js';

function walk(start, neighbors) {
  const reached = new Map([[start, { distance: 0, previous: null, kind: null }]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const { id, kind } of neighbors(current)) {
      if (reached.has(id)) continue;
      reached.set(id, { distance: reached.get(current).distance + 1, previous: current, kind });
      queue.push(id);
    }
  }
  return reached;
}

function formatPath(target, reached, name) {
  const steps = [];
  for (let id = target; id !== null; id = reached.get(id).previous) {
    const { kind } = reached.get(id);
    steps.push(kind ? `${name(id)} (${kind})` : name(id));
  }
  return steps.reverse().join(' → ');
}

function ordinal(number) {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? 'th' : ['', 'st', 'nd', 'rd'][number % 10] || 'th';
  return words[number - 1] || `${number}${suffix}`;
}

function great(label, count) {
  return count > 3 ? `${ordinal(count)} great-${label}` : 'great-'.repeat(count) + label;
}

function linealLabel(distance, role) {
  if (distance === 1) return role;
  return great(`grand${role}`, distance - 2);
}

function sharedAncestor(from, to) {
  let best = null;
  for (const [id, { distance: left }] of from) {
    if (!to.has(id)) continue;
    const right = to.get(id).distance;
    const total = left + right, longest = Math.max(left, right);
    if (!best || total < best.total || (total === best.total && longest < best.longest)
      || (total === best.total && longest === best.longest && id < best.id)) {
      best = { id, left, right, total, longest };
    }
  }
  return best;
}

function collateralLabel(left, right, role, halfSibling) {
  if (left === 1 && right === 1) return (halfSibling ? 'half-' : '') + role('sister', 'brother', 'sibling');
  if (right === 1) {
    return role(great('aunt', left - 2), great('uncle', left - 2), `${linealLabel(left - 1, 'parent')}’s sibling`);
  }
  if (left === 1) {
    return role(great('niece', right - 2), great('nephew', right - 2), `sibling’s ${linealLabel(right - 1, 'child')}`);
  }
  const removed = Math.abs(left - right);
  const removal = ['', ' once removed', ' twice removed'][removed] ?? ` ${removed} times removed`;
  return `${ordinal(Math.min(left, right) - 1)} cousin${removal}`;
}

function parentKind(link, direction) {
  if (link.type === 'adoptive') return `adoptive ${direction}`;
  if (link.type === 'step') return `step${direction}`;
  return direction;
}

export function explainRelationship(data, selectedId, otherId) {
  if (selectedId === otherId) return { summary: 'These are the same person.' };
  const { parentsByChild, childrenByParent, unionsByPerson } = buildIndexes(data);
  const name = id => personName(data.people[id]);
  const selected = name(selectedId), other = name(otherId);
  const parents = id => parentsByChild.get(id) ?? [];
  const unions = id => unionsByPerson.get(id) ?? [];
  const sex = data.people[otherId].sex;
  const role = (female, male, neutral) => sex === 'female' ? female : sex === 'male' ? male : neutral;
  const label = term => `${other} is ${selected}’s ${term}.`;
  const path = (id, map) => formatPath(id, map, name);

  const unionsTogether = unions(selectedId).filter(union => union.partnerIds.includes(otherId));
  const active = unionsTogether.filter(union => !union.end);
  let unionSummary = '';
  if (active.length) {
    unionSummary = label(active.some(union => union.type === 'marriage') ? 'spouse' : 'partner');
  } else if (unionsTogether.length) {
    unionSummary = `${selected} and ${other} ${unionsTogether.some(union => union.type === 'marriage') ? 'were married' : 'were partners'}.`;
  }
  const explainAncestry = (term, paths) => ({
    summary: unionSummary ? `${unionSummary} ${other} is also ${selected}’s ${term}.` : label(term),
    paths
  });
  const ancestors = start => walk(start, id => parents(id)
    .filter(link => link.type !== 'step' && (!unionSummary || link.type !== 'adoptive'))
    .map(link => ({ id: link.parentId, kind: parentKind(link, 'parent') })));

  const from = ancestors(selectedId), to = ancestors(otherId);
  if (from.has(otherId)) {
    const term = linealLabel(from.get(otherId).distance, role('mother', 'father', 'parent'));
    return explainAncestry(term, [path(otherId, from)]);
  }
  if (to.has(selectedId)) {
    const term = linealLabel(to.get(selectedId).distance, role('daughter', 'son', 'child'));
    return explainAncestry(term, [path(selectedId, to)]);
  }

  if (!unionSummary) {
    if (parents(selectedId).some(link => link.type === 'step' && link.parentId === otherId)) {
      return { summary: label(role('stepmother', 'stepfather', 'stepparent')) };
    }
    if (parents(otherId).some(link => link.type === 'step' && link.parentId === selectedId)) {
      return { summary: label(role('stepdaughter', 'stepson', 'stepchild')) };
    }
  }

  const common = sharedAncestor(from, to);
  if (common) {
    const { id, left, right } = common;
    let halfSibling = false;
    if (left === 1 && right === 1) {
      const recordedParents = personId => new Set(parents(personId)
        .filter(link => link.type === 'biological' || link.type === 'unknown').map(link => link.parentId));
      const a = recordedParents(selectedId), b = recordedParents(otherId);
      halfSibling = a.size === 2 && b.size === 2 && [...a].filter(parent => b.has(parent)).length === 1;
    }
    const term = collateralLabel(left, right, role, halfSibling);
    return explainAncestry(term, [path(id, from), path(id, to)]);
  }
  if (unionSummary) return { summary: unionSummary };

  const connected = walk(selectedId, id => [
    ...parents(id).map(link => ({ id: link.parentId, kind: parentKind(link, 'parent') })),
    ...(childrenByParent.get(id) ?? []).map(link => ({ id: link.childId, kind: parentKind(link, 'child') })),
    ...unions(id).map(union => ({ id: union.partnerIds.find(partner => partner !== id),
      kind: union.type === 'marriage' ? (union.end ? 'former spouse' : 'spouse') : (union.end ? 'former partner' : 'partner') }))
  ]);
  return connected.has(otherId)
    ? { summary: `${selected} and ${other} are connected through these family records.`, paths: [path(otherId, connected)] }
    : { summary: `No relationship is recorded between ${selected} and ${other}.` };
}
