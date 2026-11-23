import assert from 'node:assert/strict';
import test from 'node:test';
import { explainRelationship } from '../src/app/kinship.js';

function family(links = [], unions = [], sexes = {}) {
  const ids = new Set([...links.flatMap(([a, b]) => [a, b]), ...unions.flatMap(([a, b]) => [a, b]), ...Object.keys(sexes)]);
  return {
    people: Object.fromEntries([...ids].map(id => [id, { name: { display: id }, sex: sexes[id] }])),
    parentChild: links.map(([parentId, childId, type = 'biological']) => ({ parentId, childId, type })),
    unions: Object.fromEntries(unions.map(([a, b, end], i) => [i, { partnerIds: [a, b], type: 'marriage', end }]))
  };
}

test('explains ancestors and descendants in the direction of the right-click', () => {
  const data = family([['George', 'Ruth'], ['Ruth', 'Alex', 'adoptive'], ['Alex', 'Emma']], [], { George: 'male', Emma: 'female' });
  const explanation = explainRelationship(data, 'Emma', 'George');
  assert.equal(explanation.summary, 'George is Emma’s great-grandfather.');
  assert.deepEqual(explanation.paths, ['Emma → Alex (parent) → Ruth (adoptive parent) → George (parent)']);
  assert.equal(explainRelationship(data, 'George', 'Emma').summary, 'Emma is George’s great-granddaughter.');
});

test('distinguishes cousin degree from generations removed', () => {
  const data = family([
    ['Ancestor', 'A1'], ['A1', 'A2'], ['A2', 'A3'],
    ['Ancestor', 'B1'], ['B1', 'B2'], ['B2', 'B3'], ['B3', 'B4'], ['B4', 'B5']
  ]);
  assert.equal(explainRelationship(data, 'A3', 'B3').summary, 'B3 is A3’s second cousin.');
  assert.equal(explainRelationship(data, 'A3', 'B4').summary, 'B4 is A3’s second cousin once removed.');
  const explanation = explainRelationship(data, 'A3', 'B5');
  assert.equal(explanation.summary, 'B5 is A3’s second cousin twice removed.');
  assert.ok(explanation.paths.every(path => path.endsWith('Ancestor (parent)')));
  assert.equal(explainRelationship(data, 'B5', 'A3').summary, 'A3 is B5’s second cousin twice removed.');
});

test('labels siblings, half-siblings, and aunts without guessing a missing parent', () => {
  const data = family([
    ['Pat', 'Alex'], ['Pat', 'Beth'], ['Pat', 'Dana'], ['Robin', 'Alex'], ['Lee', 'Beth'], ['Alex', 'Chris'], ['Chris', 'Faye']
  ], [], { Alex: 'male', Beth: 'female' });
  assert.equal(explainRelationship(data, 'Alex', 'Beth').summary, 'Beth is Alex’s half-sister.');
  assert.equal(explainRelationship(data, 'Alex', 'Dana').summary, 'Dana is Alex’s sibling.');
  assert.equal(explainRelationship(data, 'Chris', 'Beth').summary, 'Beth is Chris’s aunt.');
  assert.equal(explainRelationship(data, 'Faye', 'Beth').summary, 'Beth is Faye’s great-aunt.');
  assert.equal(explainRelationship(data, 'Beth', 'Chris').summary, 'Chris is Beth’s sibling’s child.');
});

test('reports recorded step and marriage links separately from shared ancestry', () => {
  const data = family([['Pat', 'Eli'], ['Riley', 'Eli', 'step'], ['Riley', 'Blair']],
    [['Pat', 'Riley'], ['Pat', 'Lee', { reason: 'divorce' }]], { Morgan: null, Riley: 'female' });
  assert.equal(explainRelationship(data, 'Eli', 'Riley').summary, 'Riley is Eli’s stepmother.');
  assert.equal(explainRelationship(data, 'Pat', 'Riley').summary, 'Riley is Pat’s spouse.');
  assert.equal(explainRelationship(data, 'Pat', 'Lee').summary, 'Pat and Lee were married.');
  const explanation = explainRelationship(data, 'Eli', 'Blair');
  assert.deepEqual(explanation.paths, ['Eli → Riley (stepparent) → Blair (child)']);
  assert.equal(explainRelationship(data, 'Eli', 'Morgan').summary, 'No relationship is recorded between Eli and Morgan.');
});

test('explains a marriage and the closest ancestral relationship together', () => {
  const data = family([
    ['Ancestor', 'A1'], ['A1', 'A2'], ['A2', 'Alex', 'unknown'],
    ['Ancestor', 'B1'], ['B1', 'B2'], ['B2', 'B3'], ['B3', 'Beth'],
    ['Adoptive Parent', 'Alex', 'adoptive'], ['Adoptive Parent', 'Beth', 'adoptive']
  ], [['Alex', 'Beth']]);
  const explanation = explainRelationship(data, 'Alex', 'Beth');
  assert.equal(explanation.summary, 'Beth is Alex’s spouse. Beth is also Alex’s second cousin once removed.');
  assert.deepEqual(explanation.paths, [
    'Alex → A2 (parent) → A1 (parent) → Ancestor (parent)',
    'Beth → B3 (parent) → B2 (parent) → B1 (parent) → Ancestor (parent)'
  ]);
});

test('keeps the marriage summary when shared ancestry is only through adoptive or step links', () => {
  const data = family([
    ['Adoptive Parent', 'Alex', 'adoptive'], ['Adoptive Parent', 'Beth'],
    ['Step Parent', 'Alex'], ['Step Parent', 'Beth', 'step']
  ], [['Alex', 'Beth']]);
  assert.deepEqual(explainRelationship(data, 'Alex', 'Beth'), { summary: 'Beth is Alex’s spouse.' });
});
