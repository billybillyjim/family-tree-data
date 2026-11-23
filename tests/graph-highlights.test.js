import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphCanvas } from '../src/app/canvas.js';
import { getMissingDataHighlights } from '../src/app/graph.js';

test('missing parents counts distinct parents and excludes step links', () => {
  const data = {
    people: { none: {}, one: {}, two: {}, stepOnly: {} },
    parentChild: [
      { childId: 'one', parentId: 'none', type: 'biological' },
      { childId: 'one', parentId: 'none', type: 'unknown' },
      { childId: 'one', parentId: 'two', type: 'step' },
      { childId: 'two', parentId: 'one', type: 'adoptive' },
      { childId: 'two', parentId: 'none', type: 'unknown' },
      { childId: 'stepOnly', parentId: 'two', type: 'step' }
    ]
  };
  assert.deepEqual(getMissingDataHighlights(data, 'missing-parents'), new Set(['none', 'one', 'stepOnly']));
  assert.equal(getMissingDataHighlights(data, 'ancestors'), null);
});

test('missing dates finds either blank field and accepts partial dates', () => {
  const person = (id, birth, death) => ({ id, birth: { date: birth }, death: { date: death } });
  const people = {
    both: person('both', null, null),
    birth: person('birth', null, '1932-01-01'),
    death: person('death', '1925', null),
    dated: person('dated', '1925', '2007-11')
  };
  const data = { people };
  assert.deepEqual(getMissingDataHighlights(data, 'missing-dates'), new Set(['both', 'birth', 'death']));
  people.death.death.date = '2011';
  assert.deepEqual(getMissingDataHighlights(data, 'missing-dates'), new Set(['both', 'birth']));
});

test('Canvas highlights missing data without selecting a person', () => {
  const alphas = [];
  const noop = () => {};
  const ctx = {
    setTransform: noop, clearRect: noop, translate: noop, scale: noop, setLineDash: noop,
    beginPath: noop, roundRect: noop, stroke: noop,
    fill() { alphas.push(this.globalAlpha); }
  };
  const graph = Object.assign(Object.create(GraphCanvas.prototype), {
    ctx, width: 300, height: 200, dpr: 1, transform: { x: 0, y: 0, k: 0.15 },
    drawSoon: noop, data: { people: { a: {}, b: {} } },
    layout: {
      nodes: new Map(['a', 'b'].map((id, i) => [id, { id, x: i * 400, y: 0, w: 290, h: 144 }])),
      parentConnectors: [], unions: []
    }
  });
  graph.setSelection(null, new Set(['a']), { missingData: true });
  graph.draw();
  assert.deepEqual(alphas.splice(0), [1, 0.22]);
  graph.setSelection(null, new Set(), { missingData: true });
  graph.draw();
  assert.deepEqual(alphas.splice(0), [0.22, 0.22]);
  graph.setSelection(null, null);
  graph.draw();
  assert.deepEqual(alphas, [1, 1]);
});

test('Canvas outlines crossing connectors in draw order and strokes shared sibling routes together', () => {
  const strokes = [];
  const noop = () => {};
  const ctx = {
    setTransform: noop, clearRect: noop, translate: noop, scale: noop, lineTo: noop,
    beginPath() { this.starts = []; },
    moveTo(...point) { this.starts.push(point); },
    setLineDash(dash) { this.dash = dash; },
    stroke() {
      strokes.push({ starts: this.starts, dash: this.dash, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
    }
  };
  const connector = (parentId, childId, type, route) => ({ parentIds: [parentId], childId, types: [type], route });
  const graph = Object.assign(Object.create(GraphCanvas.prototype), {
    ctx, width: 300, height: 200, dpr: 1, transform: { x: 0, y: 0, k: 1 },
    drawSoon: noop, data: {}, junctions: new Map(),
    layout: {
      nodes: new Map(),
      parentConnectors: [
        connector('a', 'b', 'biological', [[30, 10], [30, 40], [90, 40], [90, 100]]),
        connector('a', 'c', 'biological', [[30, 10], [30, 40], [10, 40], [10, 100]]),
        connector('d', 'e', 'step', [[50, 10], [50, 100]])
      ],
      unions: [{ id: 'u', type: 'marriage', partnerIds: ['a', 'f'] }],
      unionRoutes: new Map([['u', [[0, 60], [100, 60]]]])
    }
  });
  graph.draw();
  assert.equal(strokes.length, 6);
  assert.deepEqual(strokes.filter((_, i) => i % 2 === 1).map(s => s.starts), [
    [[30, 10], [30, 10]], [[50, 10]], [[0, 60]]
  ]);
  for (let i = 0; i < strokes.length; i += 2) {
    const [outline, line] = strokes.slice(i, i + 2);
    assert.equal(outline.color, '#101820');
    assert.equal(outline.alpha, 1);
    assert.ok(outline.width > line.width);
    assert.deepEqual(outline.dash, line.dash);
    assert.deepEqual(outline.starts, line.starts);
  }
  assert.deepEqual(strokes[3].dash, [7, 6]);

  strokes.length = 0;
  graph.setSelection('a', new Set(['a', 'b', 'c']));
  graph.draw();
  assert.equal(strokes[3].color, '#bc6b84');
  assert.equal(strokes[3].alpha, 0.2);
  assert.equal(strokes[5].color, '#8e9cac');
  assert.equal(strokes[5].alpha, 0.8);
});
