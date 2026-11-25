import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyStore } from '../src/data/store.js';
import { newPerson } from '../src/data/schema.js';
import { linkCreatedRelative, recordedChildIds, relativeCreation } from '../src/app/relationships.js';

function familyWithChildren() {
  const store = new FamilyStore();
  for (const id of ['parent', 'first', 'second', 'unrelated']) {
    store.addPerson({ id, name: { given: id } });
  }
  store.addParentChild({ parentId: 'parent', childId: 'first', type: 'biological' });
  store.addParentChild({ parentId: 'parent', childId: 'first', type: 'adoptive' });
  store.addParentChild({ parentId: 'parent', childId: 'second', type: 'unknown' });
  return store;
}

function createSpouse(store, creation) {
  store.transaction(data => {
    const { sex, surname } = creation.form;
    data.people.spouse = newPerson('spouse', { name: { given: 'Spouse', surname }, sex });
    linkCreatedRelative(data, 'spouse', creation, () => 'marriage');
  });
}

test('creating a wife or husband links only checked children to the new spouse and marriage', () => {
  for (const role of ['wife', 'husband']) {
    const store = familyWithChildren();
    const creation = relativeCreation(store.getPerson('parent'), role);
    assert.deepEqual(creation.childIds, []);
    assert.deepEqual([...recordedChildIds(store.snapshot(), 'parent')], ['first', 'second']);
    creation.childIds.push('first', 'first');
    const existingLinks = store.getChildren('parent');

    createSpouse(store, creation);

    assert.deepEqual(store.getChildren('spouse'), [
      { parentId: 'spouse', childId: 'first', type: 'unknown', unionId: 'marriage' }
    ]);
    assert.deepEqual(store.getChildren('parent'), existingLinks);
    assert.deepEqual(store.getUnion('marriage').partnerIds, ['parent', 'spouse']);
  }
});

test('spouse creation accepts no checked children and rolls back if a checked child is unrelated', () => {
  const store = familyWithChildren();
  const creation = relativeCreation(store.getPerson('parent'), 'wife');
  const before = store.snapshot();
  assert.throws(() => createSpouse(store, { ...creation, childIds: ['first', 'unrelated'] }), /selected child/);
  assert.deepEqual(store.snapshot(), before);

  createSpouse(store, creation);
  assert.ok(store.getUnion('marriage'));
  assert.deepEqual(store.getChildren('spouse'), []);
});
