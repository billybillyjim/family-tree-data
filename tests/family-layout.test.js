import assert from 'node:assert/strict';
import test from 'node:test';
import ELK from 'elkjs';
import { buildElkLayout } from '../src/app/elk-layout.js';
import { buildLayout } from '../src/app/graph.js';
import { stressRouter } from '../src/app/stress-routes.js';
import { buildTimelineLayout } from '../src/app/timeline-layout.js';

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

test('Original Horizontal keeps cards upright and uses the original family order and junctions', () => {
  const { data, person, union, link } = pedigree();
  const parent = person('parent'), partner = person('partner');
  const first = union('first', parent, partner, '1880');
  const second = union('second', parent, partner, '1900');
  const older = person('older', '1882'), younger = person('younger', '1884');
  const halfSibling = person('half sibling', '1903'), grandchild = person('grandchild', '1911');
  const isolated = person('isolated');
  for (const [child, marriage] of [[younger, first], [halfSibling, second], [older, first]]) {
    link(parent, child, marriage);
    link(partner, child, marriage);
  }
  link(older, grandchild);
  link(halfSibling, grandchild, null, 'step');

  const vertical = buildLayout(data);
  const horizontal = buildLayout(data, { horizontal: true });
  assertClearRoutes(horizontal);
  for (const node of horizontal.nodes.values()) {
    const original = vertical.nodes.get(node.id);
    assert.deepEqual([node.w, node.h, node.depth], [original.w, original.h, original.depth]);
  }
  const card = id => horizontal.nodes.get(id);
  assert.ok(card(parent).x < card(older).x && card(older).x < card(grandchild).x);
  assert.equal(card(older).x, card(younger).x);
  assert.ok(card(older).y + card(older).h < card(younger).y);
  assert.ok(card(isolated).y > card(grandchild).y + card(grandchild).h);
  const siblings = horizontal.parentConnectors.filter(connector => connector.unionId === first);
  const other = horizontal.parentConnectors.find(connector => connector.unionId === second);
  assert.deepEqual(siblings.map(connector => connector.childId), [older, younger]);
  assert.deepEqual(siblings[0].from, siblings[1].from);
  assert.notDeepEqual(siblings[0].from, other.from);
  for (const connector of [...siblings, other]) {
    assert.equal(connector.to[0], card(connector.childId).x);
    const route = horizontal.unionRoutes.get(connector.unionId);
    assert.ok(route.some(([x, y], i) => i > 0
      && x === connector.from[0] && route[i - 1][0] === x
      && Math.min(y, route[i - 1][1]) <= connector.from[1]
      && connector.from[1] <= Math.max(y, route[i - 1][1])));
  }
});

test('Generations aligns branches from the youngest row and keeps shorter side branches near their parents', () => {
  const { data, person, union, link } = pedigree();
  const a = person('great-grandparent'), b = person('grandparent'), c = person('parent');
  const partner = person('partner'), d = person('child', '2002'), e = person('sibling', '2001');
  const aunt = person('aunt'), p = person('other grandparent'), q = person('other parent'), r = person('other child');
  link(a, b);
  link(a, aunt);
  link(b, c);
  const marriage = union('marriage', c, partner);
  for (const child of [d, e]) {
    link(c, child, marriage);
    link(partner, child, marriage);
  }
  link(p, q);
  link(q, r);
  const layout = buildLayout(data, { fromYoungest: true });
  assertSeparated(layout);
  assertClearRoutes(layout);
  const card = id => layout.nodes.get(id);
  for (const row of [[b, aunt, p], [c, partner, q], [d, e, r]]) {
    assert.equal(new Set(row.map(id => card(id).y)).size, 1);
  }
  assert.ok(card(a).y < card(b).y && card(b).y < card(c).y && card(c).y < card(d).y);
  assert.ok(card(e).x < card(d).x);
  for (const { parentId, childId } of data.parentChild) {
    assert.equal(card(childId).depth, card(parentId).depth + 1);
  }
});

test('ELK keeps birth order and gives each marriage its own junction', async () => {
  const { data, person, union, link } = pedigree();
  const parent = person('parent'), partner = person('partner');
  const first = union('first', parent, partner, '1990');
  const second = union('second', parent, partner, '2000');
  const earlier = person('earlier', '2001');
  const later = person('later', '2003');
  const only = person('only', '1993');
  for (const [child, marriage] of [[later, second], [only, first], [earlier, second]]) {
    link(parent, child, marriage);
    link(partner, child, marriage);
  }
  const elk = new ELK();
  const layout = await buildElkLayout(data, elk);
  assertSeparated(layout);
  assertClearRoutes(layout);
  assert.equal(layout.nodes.size, 5);
  const a = layout.nodes.get(earlier), b = layout.nodes.get(later);
  assert.equal(a.y, b.y);
  assert.ok(a.x < b.x);
  const firstChild = layout.parentConnectors.find(connector => connector.unionId === first);
  const siblings = layout.parentConnectors.filter(connector => connector.unionId === second);
  assert.deepEqual(siblings.map(connector => connector.childId), [earlier, later]);
  assert.deepEqual(siblings[0].from, siblings[1].from);
  assert.notDeepEqual(firstChild.from, siblings[0].from);
  for (const connector of [firstChild, ...siblings]) {
    assert.ok(layout.unionRoutes.get(connector.unionId).some(point => point.every((value, i) => value === connector.from[i])));
  }
  const reordered = await buildElkLayout({ ...data, parentChild: [...data.parentChild].reverse() }, elk);
  assert.deepEqual(reordered.nodes, layout.nodes);
  assert.deepEqual(reordered.parentConnectors, layout.parentConnectors);
  assert.deepEqual(reordered.unionRoutes, layout.unionRoutes);
});

test('ELK routes step relationships in either direction without moving siblings to different rows', async () => {
  const { data, person, link } = pedigree();
  const parent = person('parent');
  const older = person('older', '1995'), younger = person('younger', '1999');
  link(parent, older);
  link(parent, younger);
  link(older, younger, null, 'step');
  link(older, parent, null, 'step');
  const layout = await buildElkLayout(data, new ELK());
  assertClearRoutes(layout);
  const a = layout.nodes.get(older), b = layout.nodes.get(younger);
  assert.equal(a.y, b.y);
  assert.ok(a.x < b.x);
  const steps = layout.parentConnectors.filter(connector => connector.types.includes('step'));
  assert.equal(steps.length, 2);
  for (const connector of steps) {
    const child = layout.nodes.get(connector.childId);
    assert.ok(connector.from[0] >= a.x && connector.from[0] <= a.x + a.w);
    assert.ok(connector.to[0] >= child.x && connector.to[0] <= child.x + child.w);
  }
});

test('ELK Stress keeps cards separate and connects marriage branches to their junction', async () => {
  const { data, person, union, link } = pedigree();
  const a = person('a'), b = person('b'), child = person('child');
  const marriage = union('marriage', a, b);
  link(a, child, marriage);
  link(b, child, marriage);
  for (let i = 0; i < 12; i++) link(child, person('descendant ' + i));
  person('isolated');

  const elk = new ELK();
  const layout = await buildElkLayout(data, elk, 'stress');
  const cards = [...layout.nodes.values()];
  assert.equal(cards.length, Object.keys(data.people).length);
  for (const [i, card] of cards.entries()) {
    assert.ok(cards.slice(i + 1).every(other =>
      card.x + card.w <= other.x || other.x + other.w <= card.x ||
      card.y + card.h <= other.y || other.y + other.h <= card.y));
  }
  const childRoute = layout.parentConnectors.find(connector => connector.childId === child);
  assert.ok(layout.unionRoutes.get(marriage).some(point => point.every((value, i) => value === childRoute.from[i])));
  assert.ok(layout.parentConnectors.some(({ route }) => route.some(([x, y], i) =>
    i > 0 && x !== route[i - 1][0] && y !== route[i - 1][1])));
  assert.equal(layout.parentConnectors.length, 13);
});

test('Stress connectors clear blocking cards and end on their own card edges', () => {
  const left = { x: 0, y: 0, width: 20, height: 20 };
  const right = { x: 100, y: 0, width: 20, height: 20 };
  const blocker = { x: 40, y: 0, width: 40, height: 20 };
  const route = stressRouter(new Map([['a', left], ['b', right], ['obstacle', blocker]]))(left, right);
  assert.equal(route[0][0], 20);
  assert.equal(route.at(-1)[0], 100);
  const [firstCorner, secondCorner] = route.slice(1, -1);
  assert.equal(firstCorner[1], secondCorner[1]);
  assert.ok(firstCorner[1] < blocker.y || firstCorner[1] > blocker.y + blocker.height);
  assert.ok(firstCorner[0] < blocker.x && secondCorner[0] > blocker.x + blocker.width);
});

test('Timeline places births on a linear year axis and leaves room for cards at the same date', () => {
  const { data, person, union, link } = pedigree();
  const parent = person('parent', '1840-01-02'), partner = person('partner', '1840-09');
  const child = person('child', '1865'), grandchild = person('grandchild', '1890');
  const unknown = person('unknown');
  const marriage = union('marriage', parent, partner);
  link(parent, child, marriage);
  link(partner, child, marriage);
  link(child, grandchild);
  link(child, unknown);
  const layout = buildTimelineLayout(data);
  assertSeparated(layout);
  const y = id => {
    const node = layout.nodes.get(id);
    return node.y + node.h / 2;
  };
  assert.equal(layout.timeline.firstYear, 1840);
  assert.equal(y(parent), y(partner));
  assert.equal(y(child) - y(parent), y(grandchild) - y(child));
  assert.equal(y(child) - y(parent), 25 * layout.timeline.yearSpacing);
  assert.equal(y(unknown), layout.timeline.unknownY);
  assert.ok(y(unknown) > y(grandchild));
  const connector = layout.parentConnectors.find(connector => connector.unionId === marriage);
  assert.ok(layout.unionRoutes.get(marriage).some(point => point.every((value, i) => value === connector.from[i])));
});

test('Timeline has an undated row even when every birth year is missing', () => {
  const { data, person } = pedigree();
  const id = person('unknown');
  const layout = buildTimelineLayout(data);
  const card = layout.nodes.get(id);
  assert.equal(layout.timeline.firstYear, null);
  assert.equal(layout.timeline.lastYear, null);
  assert.equal(layout.timeline.unknownY, card.y + card.h / 2);
});
