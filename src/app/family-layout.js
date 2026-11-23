const CARD_WIDTH = 290;
const CARD_HEIGHT = 144;
const PARTNER_GAP = 56;
const SIBLING_GAP = 90;
const FAMILY_GAP = 170;

const name = person => person.name.display || [person.name.given, person.name.surname].join(' ').trim();

export function birthOrder(a, b) {
  return (a.birth.date || '9999').localeCompare(b.birth.date || '9999')
    || name(a).localeCompare(name(b)) || a.id.localeCompare(b.id);
}

export function unionOrder(a, b) {
  return (a.start?.date || '9999').localeCompare(b.start?.date || '9999') || a.id.localeCompare(b.id);
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function collectFamilies(links, unions, comparePeople) {
  const linksByChild = new Map();
  const unionsByPair = new Map();
  for (const link of links) addTo(linksByChild, link.childId, link);
  for (const union of unions) {
    const pair = JSON.stringify([...union.partnerIds].sort());
    if (!unionsByPair.has(pair)) unionsByPair.set(pair, union);
  }

  const unionById = new Map(unions.map(union => [union.id, union]));
  const families = new Map();
  for (const [childId, childLinks] of linksByChild) {
    const unassigned = new Map(), assigned = new Map();
    for (const link of childLinks) {
      if (link.unionId) addTo(assigned, unionById.get(link.unionId), link);
      else addTo(unassigned, link.parentId, link);
    }

    // Imported assignments take precedence. Older records can infer a union
    // when both partners have a recorded parent link to this child.
    const parents = [...new Set(childLinks.filter(link => link.type !== 'step').map(link => link.parentId))].sort();
    const candidates = new Set(assigned.keys());
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const union = unionsByPair.get(JSON.stringify([parents[i], parents[j]]));
        if (union) candidates.add(union);
      }
    }
    const ordered = [...candidates].sort((a, b) => (assigned.get(b)?.length || 0) - (assigned.get(a)?.length || 0) || unionOrder(a, b));
    function record(key, sourceIds, familyLinks, unionId = null) {
      if (!families.has(key)) families.set(key, { key, sourceIds, links: [] });
      const parentIds = [...new Set(familyLinks.map(link => link.parentId))].sort(comparePeople);
      const types = [...new Set(familyLinks.map(link => link.type))].sort();
      families.get(key).links.push({ childId, parentIds, unionId, types });
    }

    for (const union of ordered) {
      const explicit = assigned.get(union) || [];
      const inferred = union.partnerIds.map(id => (unassigned.get(id) || []).filter(link => link.type !== 'step'));
      if (!explicit.length && !inferred.every(links => links.length)) continue;
      record(JSON.stringify(['union', union.id]), union.partnerIds, [...explicit, ...inferred.flat()], union.id);
      for (const [index, id] of union.partnerIds.entries()) {
        if (inferred[index].length) unassigned.set(id, unassigned.get(id).filter(link => link.type === 'step'));
      }
    }
    for (const [parentId, remaining] of unassigned) {
      const ancestry = remaining.filter(link => link.type !== 'step');
      const steps = remaining.filter(link => link.type === 'step');
      if (ancestry.length) record(JSON.stringify(['parent', parentId]), [parentId], ancestry);
      if (steps.length) record(JSON.stringify(['step', parentId]), [parentId], steps);
    }
  }
  const ordered = [...families.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const family of ordered) family.links.sort((a, b) => comparePeople(a.childId, b.childId));
  return ordered;
}

function partnershipBlocks(ids, unionsByPerson, rank) {
  const blocks = [], blockByPerson = new Map();
  for (const id of ids) {
    if (blockByPerson.has(id)) continue;
    const block = { ids: [id], depth: rank ? rank.get(id) : 0, branches: new Map() };
    blocks.push(block);
    blockByPerson.set(id, block);
    for (let i = 0; i < block.ids.length; i++) {
      for (const union of unionsByPerson.get(block.ids[i])) {
        const partner = union.partnerIds.find(partnerId => partnerId !== block.ids[i]);
        if (blockByPerson.has(partner) || (rank && rank.get(partner) !== block.depth)) continue;
        blockByPerson.set(partner, block);
        block.ids.push(partner);
      }
    }
  }
  return { blocks, blockByPerson };
}

function rankAncestry(groups, groupByPerson, links) {
  const descendants = new Map(groups.map(group => [group, new Set()]));
  const indegree = new Map(groups.map(group => [group, 0]));
  for (const link of links) {
    if (link.type === 'step') continue;
    const parent = groupByPerson.get(link.parentId), child = groupByPerson.get(link.childId);
    if (parent === child) return false;
    if (descendants.get(parent).has(child)) continue;
    descendants.get(parent).add(child);
    indegree.set(child, indegree.get(child) + 1);
  }

  const ordered = groups.filter(group => indegree.get(group) === 0);
  for (let i = 0; i < ordered.length; i++) {
    const parent = ordered[i];
    for (const child of descendants.get(parent)) {
      child.depth = Math.max(child.depth, parent.depth + 1);
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) ordered.push(child);
    }
  }
  if (ordered.length !== groups.length) return false;

  // Bring shorter ancestry branches down toward their first child.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const group = ordered[i];
    let firstChild = Infinity;
    for (const child of descendants.get(group)) firstChild = Math.min(firstChild, child.depth);
    if (firstChild < Infinity) group.depth = firstChild - 1;
  }
  return true;
}

function rankWithSiblings(blocks, blockByPerson, links) {
  const groupFor = new Map(blocks.map(block => [block, block]));
  function find(block) {
    while (groupFor.get(block) !== block) {
      const parent = groupFor.get(block);
      groupFor.set(block, groupFor.get(parent));
      block = parent;
    }
    return block;
  }
  const firstChild = new Map();
  for (const { parentId, childId, type } of links) {
    if (type === 'step') continue;
    const child = blockByPerson.get(childId);
    if (firstChild.has(parentId)) groupFor.set(find(child), find(firstChild.get(parentId)));
    else firstChild.set(parentId, child);
  }
  const siblingGroups = new Map(), groupByPerson = new Map();
  for (const block of blocks) {
    const root = find(block);
    if (!siblingGroups.has(root)) siblingGroups.set(root, { depth: 0 });
    for (const id of block.ids) groupByPerson.set(id, siblingGroups.get(root));
  }
  if (!rankAncestry([...siblingGroups.values()], groupByPerson, links)) return false;
  for (const block of blocks) block.depth = groupByPerson.get(block.ids[0]).depth;
  return true;
}

function orderPartners(block, blockByPerson, unionsByPerson, people, comparePeople) {
  if (block.ids.length === 1) return;
  if (block.ids.length === 2) {
    const side = id => people[id].sex === 'female' ? 0 : people[id].sex === 'male' ? 2 : 1;
    block.ids.sort((a, b) => side(a) - side(b) || comparePeople(a, b));
    return;
  }

  const partners = new Map(block.ids.map(id => [id, new Set(unionsByPerson.get(id)
    .map(union => union.partnerIds.find(partner => partner !== id))
    .filter(partner => blockByPerson.get(partner) === block))]));
  const pivot = block.ids.reduce((a, b) => {
    const order = partners.get(a).size - partners.get(b).size || comparePeople(b, a);
    return order >= 0 ? a : b;
  });
  // Keep partners in order of their first union with this person.
  if (partners.get(pivot).size === block.ids.length - 1) {
    const firstDate = new Map();
    for (const union of unionsByPerson.get(pivot)) {
      const partner = union.partnerIds.find(id => id !== pivot);
      if (!firstDate.has(partner)) firstDate.set(partner, union.start?.date || '9999');
    }
    const ordered = [...partners.get(pivot)].sort((a, b) => firstDate.get(a).localeCompare(firstDate.get(b)) || comparePeople(a, b));
    ordered.splice(Math.floor(ordered.length / 2), 0, pivot);
    block.ids = ordered;
    return;
  }
  // A chain can place every couple side by side.
  if (partners.get(pivot).size === 2) {
    const ends = block.ids.filter(id => partners.get(id).size === 1).sort(comparePeople);
    if (ends.length) {
      const ordered = [ends[0]];
      for (let i = 0; i < ordered.length; i++) {
        for (const partner of partners.get(ordered[i])) {
          if (partner !== ordered[i - 1]) ordered.push(partner);
        }
      }
      block.ids = ordered;
      return;
    }
  }
  // Keep the most connected person near the middle of more complex groups.
  const left = [], right = [], queue = [pivot], seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const partner of partners.get(id)) {
      if (seen.has(partner)) continue;
      seen.add(partner);
      queue.push(partner);
      (left.length <= right.length ? left : right).push(partner);
    }
  }
  block.ids = [...left.reverse(), pivot, ...right];
}

function alignJoinedBranches(blocks, families, owner, blockByPerson, indexByPerson) {
  const rowByDepth = new Map(), unitByBlock = new Map(), offsets = new Map();
  for (const block of [...blocks].sort((a, b) => a.x - b.x)) {
    if (!rowByDepth.has(block.depth)) rowByDepth.set(block.depth, new Map());
    const row = rowByDepth.get(block.depth);
    const group = owner.get(block)?.family || block;
    if (!row.has(group)) row.set(group, { members: [], links: [], width: 0, x: 0 });
    const unit = row.get(group);
    if (unit.members.length) unit.width += SIBLING_GAP;
    unit.members.push({ block, offset: unit.width });
    for (const id of block.ids) {
      offsets.set(id, unit.width + indexByPerson.get(id) * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2);
    }
    unit.width += block.cardWidth;
    unitByBlock.set(block, unit);
  }
  for (const family of families) {
    for (const link of family.links) {
      if (link.types.every(type => type === 'step')) continue;
      const childBlock = blockByPerson.get(link.childId);
      const child = unitByBlock.get(childBlock);
      // A large sibling set can otherwise outweigh the only link to the
      // other side of a joined household.
      const weight = owner.get(childBlock)?.family === family ? 1 : Math.max(4, family.links.length);
      for (const id of link.parentIds) {
        const parent = unitByBlock.get(blockByPerson.get(id));
        if (parent === child) continue;
        const delta = offsets.get(id) - offsets.get(link.childId);
        child.links.push({ neighbor: parent, delta, weight });
        parent.links.push({ neighbor: child, delta: -delta, weight });
      }
    }
  }

  // Keep siblings in one unit, but let a joined household pull both sides
  // of its ancestry closer. Project each row onto its minimum card spacing.
  const rows = [...rowByDepth].sort(([a], [b]) => a - b).map(([, units]) => [...units.values()]);
  function alignRow(row) {
    for (const unit of row) {
      let sum = unit.x;
      unit.weight = 1;
      for (const { neighbor, delta, weight } of unit.links) {
        sum += weight * (neighbor.x + delta);
        unit.weight += weight;
      }
      unit.target = sum / unit.weight;
    }
    row.sort((a, b) => a.target + a.width / 2 - b.target - b.width / 2);
    const pools = [];
    let end = 0;
    for (const [i, unit] of row.entries()) {
      unit.minimum = end;
      end += unit.width + FAMILY_GAP;
      const weight = unit.weight;
      const pool = { first: i, last: i, weight, sum: weight * (unit.target - unit.minimum) };
      while (pools.length && pools.at(-1).sum / pools.at(-1).weight > pool.sum / pool.weight) {
        const previous = pools.pop();
        pool.first = previous.first;
        pool.sum += previous.sum;
        pool.weight += previous.weight;
      }
      pools.push(pool);
    }
    for (const { first, last, sum, weight } of pools) {
      for (let i = first; i <= last; i++) row[i].x = row[i].minimum + sum / weight;
    }
  }
  for (const row of rows) {
    const width = row.reduce((sum, unit) => sum + unit.width + FAMILY_GAP, -FAMILY_GAP);
    let x = -width / 2;
    for (const unit of row) {
      unit.x = x;
      x += unit.width + FAMILY_GAP;
    }
  }
  for (let sweep = 0; sweep < 24; sweep++) {
    for (const row of rows) alignRow(row);
    rows.reverse();
  }
  for (const row of rows) for (const unit of row) {
    for (const { block, offset } of unit.members) block.x = unit.x + offset;
  }
}

function placeBranches(blocks, blockByPerson, families, comparePeople) {
  const indexByPerson = new Map();
  const owner = new Map();
  for (const block of blocks) {
    block.ids.forEach((id, index) => indexByPerson.set(id, index));
    block.cardWidth = block.ids.length * (CARD_WIDTH + PARTNER_GAP) - PARTNER_GAP;
  }
  for (const family of families) {
    const source = family.sourceIds.map(id => blockByPerson.get(id)).reduce((a, b) => a.depth >= b.depth ? a : b);
    family.anchor = family.sourceIds.reduce((sum, id) => {
      const index = blockByPerson.get(id) === source ? indexByPerson.get(id) : (source.ids.length - 1) / 2;
      return sum + index / family.sourceIds.length;
    }, 0);
    for (const link of family.links) {
      const child = blockByPerson.get(link.childId);
      if (child.depth <= source.depth || link.types.every(type => type === 'step')) continue;
      const previous = owner.get(child);
      const distance = child.depth - source.depth;
      const better = !previous || distance < previous.distance
        || (distance === previous.distance && Number(!!link.unionId) > Number(!!previous.link.unionId))
        || (distance === previous.distance && !!link.unionId === !!previous.link.unionId && comparePeople(link.childId, previous.link.childId) < 0);
      if (better) owner.set(child, { source, family, link, distance });
    }
  }
  for (const [child, { source, family, link }] of owner) {
    child.birthId = link.childId;
    addTo(source.branches, family, child);
  }
  const compareBlocks = (a, b) => comparePeople(a.birthId || a.ids[0], b.birthId || b.ids[0]);

  // Measure subtree widths from bottom to top, then give each branch its
  // own band. Each block has at most one placement parent and all links
  // remain available to the router.
  const ordered = [...blocks].sort((a, b) => a.depth - b.depth);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const block = ordered[i];
    const children = [];
    let width = 0;
    const branches = [...block.branches].sort(([a], [b]) => a.anchor - b.anchor || a.key.localeCompare(b.key));
    for (const [, siblings] of branches) {
      if (children.length) width += FAMILY_GAP;
      siblings.sort(compareBlocks);
      for (const [index, child] of siblings.entries()) {
        if (index) width += child.children.length || siblings[index - 1].children.length ? FAMILY_GAP : SIBLING_GAP;
        children.push({ child, x: width });
        width += child.width;
      }
    }
    block.width = Math.max(block.cardWidth, width);
    block.childOffset = (block.width - width) / 2;
    block.children = children;
  }

  let width = 0;
  for (const root of ordered.filter(block => !owner.has(block)).sort(compareBlocks)) {
    if (width) width += FAMILY_GAP;
    root.x = width;
    width += root.width;
  }
  for (const block of ordered) {
    for (const { child, x } of block.children) child.x = block.x + block.childOffset + x;
    block.x += (block.width - block.cardWidth) / 2;
  }
  const joined = families.some(family => family.links.some(link => {
    const child = blockByPerson.get(link.childId);
    const placement = owner.get(child);
    return placement && !link.types.every(type => type === 'step')
      && (placement.family !== family || placement.distance > 1);
  }));
  if (joined) alignJoinedBranches(blocks, families, owner, blockByPerson, indexByPerson);

  let left = Infinity, right = -Infinity;
  for (const block of blocks) {
    left = Math.min(left, block.x);
    right = Math.max(right, block.x + block.cardWidth);
  }
  const nodes = new Map(), rows = new Map();
  for (const block of ordered) {
    block.ids.forEach((id, index) => {
      const node = { id, x: block.x - left + index * (CARD_WIDTH + PARTNER_GAP), y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, depth: block.depth };
      nodes.set(id, node);
      addTo(rows, node.depth, node);
    });
  }
  for (const row of rows.values()) row.sort((a, b) => a.x - b.x);
  return { nodes, rows, width: right - left };
}

export function arrangeFamilies(ids, links, unions, people) {
  const comparePeople = (a, b) => birthOrder(people[a], people[b]);
  ids = [...ids].sort(comparePeople);
  const unionsByPerson = new Map(ids.map(id => [id, []]));
  for (const union of unions) {
    for (const id of union.partnerIds) unionsByPerson.get(id).push(union);
  }
  let { blocks, blockByPerson } = partnershipBlocks(ids, unionsByPerson);
  if (!rankWithSiblings(blocks, blockByPerson, links) && !rankAncestry(blocks, blockByPerson, links)) {
    // Cross-generation partnerships can make a common rank impossible.
    const individuals = ids.map(id => ({ ids: [id], depth: 0 }));
    rankAncestry(individuals, new Map(individuals.map(group => [group.ids[0], group])), links);
    const rank = new Map(individuals.map(group => [group.ids[0], group.depth]));
    ({ blocks, blockByPerson } = partnershipBlocks(ids, unionsByPerson, rank));
  }
  for (const block of blocks) orderPartners(block, blockByPerson, unionsByPerson, people, comparePeople);
  const families = collectFamilies(links, unions, comparePeople);
  return { ...placeBranches(blocks, blockByPerson, families, comparePeople), families };
}
