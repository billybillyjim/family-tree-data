import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLayout } from '../src/app/graph.js';

function pedigree() {
  const data = { people: {}, unions: {}, places: {}, parentChild: [] };
  return {
    data,
    person(id, date = null) {
      data.people[id] = { id, name: { display: id }, birth: { date } };
      return id;
    },
    union(id, a, b, date = null) {
      data.unions[id] = { id, partnerIds: [a, b], start: { date }, type: 'marriage' };
      return id;
    },
    link(parentId, childId, unionId = null, type = 'biological') {
      data.parentChild.push({ parentId, childId, unionId, type });
    }
  };
}

function assertSeparated(layout) {
  const rows = new Map();
  for (const node of layout.nodes.values()) {
    if (!rows.has(node.y)) rows.set(node.y, []);
    rows.get(node.y).push(node);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i - 1].x + row[i - 1].w + 50 <= row[i].x, 'cards are separated');
    }
  }
}

function assertClearRoutes(layout) {
  const paths = [...layout.unionRoutes.values(), ...layout.parentConnectors.map(line => line.route)];
  for (const route of paths) {
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1], [bx, by] = route[i];
      assert.ok(ax === bx || ay === by, 'segments are orthogonal');
      for (const node of layout.nodes.values()) {
        const intersects = Math.max(ax, bx) > node.x && Math.min(ax, bx) < node.x + node.w
          && Math.max(ay, by) > node.y && Math.min(ay, by) < node.y + node.h;
        assert.equal(intersects, false, 'a connector does not pass through a card');
      }
    }
    for (const [x, y] of route) {
      assert.ok(x >= layout.bounds.minX && x <= layout.bounds.maxX);
      assert.ok(y >= layout.bounds.minY && y <= layout.bounds.maxY);
    }
  }
}

test('separate marriages have distinct junctions and contiguous birth-ordered descendant groups', () => {
  const { data, person, union, link } = pedigree();
  const parent = person('shared parent');
  const expected = new Map();
  for (let i = 0; i < 4; i++) {
    const partner = person('partner ' + i);
    const marriage = union('marriage ' + i, parent, partner, String(1990 + i));
    const children = [];
    for (let j = 2; j >= 0; j--) {
      const child = person('child ' + i + '.' + j, String(2010 + j));
      children.unshift(child);
      link(parent, child, marriage);
      link(partner, child);
      link(child, person('grandchild ' + i + '.' + j));
    }
    expected.set(marriage, children);
  }
  const layout = buildLayout(data);
  assertSeparated(layout);
  assertClearRoutes(layout);
  assert.equal(layout.nodes.size, Object.keys(data.people).length);
  const junctions = new Set(), groups = [];
  for (const [marriage, children] of expected) {
    const connectors = layout.parentConnectors.filter(line => line.unionId === marriage);
    assert.deepEqual(connectors.map(line => line.childId), children);
    assert.equal(new Set(connectors.map(line => line.from.toString())).size, 1);
    assert.equal(new Set(connectors.map(line => line.route[1][1])).size, 1, 'siblings share a bus');
    junctions.add(connectors[0].from.toString());
    const cards = children.map(id => layout.nodes.get(id));
    assert.ok(cards.every((node, i) => !i || cards[i - 1].x < node.x));
    groups.push([cards[0].x, cards.at(-1).x + cards.at(-1).w]);
  }
  assert.equal(junctions.size, expected.size);
  groups.sort((a, b) => a[0] - b[0]);
  assert.ok(groups.every(([left], i) => !i || left - groups[i - 1][1] >= 150));
  const reordered = { ...data, parentChild: [...data.parentChild].reverse() };
  assert.deepEqual(buildLayout(reordered).nodes, layout.nodes);
  assert.deepEqual(buildLayout(reordered).parentConnectors, layout.parentConnectors);
});

test('repeat marriages keep explicit children separate, and step links stay independent', () => {
  const { data, person, union, link } = pedigree();
  const a = person('a'), b = person('b'), step = person('step parent');
  const first = union('first', a, b, '1990');
  const second = union('second', a, b, '2010');
  union('other', a, step, '1980');
  const c = person('c'), d = person('d');
  link(a, c);
  link(b, c);
  link(a, d, second);
  link(b, d);
  link(step, c, null, 'step');
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  const firstLine = layout.parentConnectors.find(line => line.unionId === first);
  const secondLine = layout.parentConnectors.find(line => line.unionId === second);
  assert.deepEqual([firstLine.childId, secondLine.childId], [c, d]);
  assert.notEqual(firstLine.from[0], secondLine.from[0]);
  const stepLine = layout.parentConnectors.find(line => line.types.includes('step'));
  assert.equal(stepLine.unionId, null);
  assert.deepEqual(stepLine.parentIds, [step]);
});

test('dated partners stay in chronological order and longer marriage routes wrap shorter routes', () => {
  const { data, person, union } = pedigree();
  const shared = person('shared');
  const partners = ['f', 'a', 'e', 'b', 'd', 'c'].map(id => person(id));
  const marriages = partners.map((id, i) => union('marriage ' + i, shared, id, String(1900 + i)));
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  const cards = [...layout.nodes.values()].sort((a, b) => a.x - b.x);
  assert.deepEqual(cards.map(card => card.id), [...partners.slice(0, 3), shared, ...partners.slice(3)]);
  for (const [outer, inner] of [[marriages[0], marriages[1]], [marriages[5], marriages[4]]]) {
    const [, outerLeft, outerRight] = layout.unionRoutes.get(outer);
    const [, innerLeft, innerRight] = layout.unionRoutes.get(inner);
    assert.ok(outerLeft[0] < innerLeft[0] && outerRight[0] > innerRight[0]);
    assert.ok(outerLeft[1] > innerLeft[1]);
  }
});

test('a chain of partnerships puts every couple next to each other', () => {
  const { data, person, union } = pedigree();
  const chain = ['a', 'd', 'b', 'e', 'c'].map(id => person(id));
  chain.slice(1).forEach((id, i) => union('marriage ' + i, chain[i], id));
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  const cards = [...layout.nodes.values()].sort((a, b) => a.x - b.x);
  assert.deepEqual(cards.map(card => card.id), chain);
  assert.ok([...layout.unionRoutes.values()].every(route => route.length === 2));
});

test('ancestry and step routes leave the same parent at distinct ports', () => {
  const { data, person, link } = pedigree();
  const parent = person('parent');
  link(parent, person('child'));
  link(parent, person('stepchild'), null, 'step');
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  const [child, stepchild] = layout.parentConnectors;
  assert.equal(child.from[1], stepchild.from[1]);
  assert.notEqual(child.from[0], stepchild.from[0]);
});

test('cross-generation partnerships and links spanning rows route around cards', () => {
  const { data, person, union, link } = pedigree();
  const a = person('a'), b = person('b'), c = person('c'), d = person('d'), e = person('e');
  link(a, b);
  link(b, c);
  link(c, d);
  link(a, d);
  const marriage = union('cross-generation', a, c);
  link(a, e, marriage);
  link(c, e, marriage);
  link(d, a, null, 'step');
  const isolated = person('isolated');
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  assert.ok(layout.nodes.get(c).depth > layout.nodes.get(a).depth);
  assert.ok(layout.nodes.get(d).depth > layout.nodes.get(c).depth);
  assert.ok(layout.nodes.get(isolated).x > Math.max(...layout.unionRoutes.get(marriage).map(([x]) => x)));
});

test('joining a deeper pedigree keeps a child near both branches and on the same row as siblings', () => {
  const { data, person, union, link } = pedigree();
  const left = person('a parent'), right = person('b parent');
  const marriage = union('early family', left, right);
  const child = person('child joining both branches');
  const siblings = [child];
  for (let i = 0; i < 8; i++) siblings.push(person('sibling ' + i));
  for (const sibling of siblings) {
    link(left, sibling, marriage);
    link(right, sibling, marriage);
  }

  let ancestor = person('z ancestor');
  for (let i = 0; i < 6; i++) {
    const descendant = person('z descendant ' + i);
    link(ancestor, descendant);
    if (i === 5) union('joined household', child, descendant);
    else ancestor = descendant;
  }
  const layout = buildLayout(data);
  assertSeparated(layout);
  assertClearRoutes(layout);
  const card = layout.nodes.get(child);
  const incoming = layout.parentConnectors.find(line => line.childId === child);
  assert.equal(card.depth, layout.nodes.get(left).depth + 1);
  assert.ok(siblings.every(id => layout.nodes.get(id).depth === card.depth));
  assert.equal(incoming.route.length, 4);
  const siblingSpan = layout.nodes.get(siblings.at(-1)).x + card.w - card.x;
  assert.ok(Math.abs(incoming.from[0] - incoming.to[0]) < siblingSpan / 2 + card.w);
  const other = layout.parentConnectors.find(line => line.childId === 'z descendant 5');
  assert.ok(Math.abs(other.from[0] - other.to[0]) < 5 * card.w);
});

test('a skipped-generation connector uses a clear column near its endpoints', () => {
  const { data, person, link } = pedigree();
  const a = person('a'), b = person('b'), c = person('c'), d = person('d');
  link(a, b);
  link(b, c);
  link(c, d);
  link(a, d);
  for (let i = 0; i < 10; i++) link(a, person('sibling ' + i));
  const layout = buildLayout(data);
  assertClearRoutes(layout);
  const skipped = layout.parentConnectors.find(line => line.childId === d && line.parentIds.includes(a));
  assert.equal(skipped.route.length, 6);
  const [column] = skipped.route[2];
  assert.ok(column < layout.bounds.maxX - layout.nodes.get(d).w);
  assert.ok(Math.abs(column - skipped.from[0]) < 2 * layout.nodes.get(d).w);
});

test('lays out deep and wide branches without recursion', () => {
  const { data, person, link } = pedigree();
  let parent = person('root');
  for (let i = 0; i < 6000; i++) {
    const child = person('generation ' + i);
    link(parent, child);
    parent = child;
  }
  for (let i = 0; i < 3000; i++) link(parent, person('sibling ' + i));
  const layout = buildLayout(data);
  assert.equal(layout.nodes.size, 9001);
  assert.equal(layout.parentConnectors.length, 9000);
  assert.equal(layout.nodes.get('sibling 2999').depth, 6001);
  assertSeparated(layout);
});
