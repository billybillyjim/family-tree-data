import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePersonEntries } from '../src/app/paste.js';
import { addChildren, parseChildren } from '../src/app/children.js';
import { FamilyStore } from '../src/data/index.js';

const wife = `[**Jerilynn A Miller**](https://www.familysearch.org/en/tree/person/PQDC-J2G)
Female
PQDC-J2G
[Sources (12)](https://www.familysearch.org/en/tree/person/sources/PQDC-J2G)
[Memories (0)](https://www.familysearch.org/en/tree/person/memories/PQDC-J2G)
[Collaborate (0)](https://www.familysearch.org/en/tree/person/collaborate/PQDC-J2G)
**Birth:** 22 April 1942Blue Earth, Minnesota, United States
**Death:** 3 January 2021`;

const husband = `Example Person
Male
Birth:
July 1938
Minnesota, United States`;

test('reads a FamilySearch profile with a linked name and a joined date and place', () => {
  assert.deepEqual(parsePersonEntries(wife), [{
    name: 'Jerilynn A Miller', sex: 'female', birthDate: '1942-04-22',
    birthPlace: 'Blue Earth, Minnesota, United States', deathDate: '2021-01-03',
    deathPlace: '', notes: wife
  }]);
});

test('reads plain multiline profiles and preserves child-specific surname handling', () => {
  const profiles = `${wife}\n\n${husband}`;
  const entries = parsePersonEntries(profiles);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1], {
    name: 'Example Person', sex: 'male', birthDate: '1938-07',
    birthPlace: 'Minnesota, United States', deathDate: '', deathPlace: '', notes: husband
  });
  const children = parseChildren(profiles, 'Miller');
  assert.deepEqual(children.map(({ given, surname, birthDate }) => ({ given, surname, birthDate })), [
    { given: 'Jerilynn A', surname: '', birthDate: '1942-04-22' },
    { given: 'Example', surname: '', birthDate: '1938-07' }
  ]);
});

test('keeps two-word pasted surnames together when enabled', () => {
  const profiles = 'Anna Maria van Bockel\nFemale\nJan van Bockel\nMale\nEva Smit\nFemale';
  const names = rows => rows.map(({ given, surname }) => [given, surname]);
  assert.deepEqual(names(parseChildren(profiles, 'Bockel', true)), [
    ['Anna Maria', 'van Bockel'],
    ['Jan', ''],
    ['Eva', 'Smit']
  ]);
  assert.deepEqual(names(parseChildren(profiles, 'van Bockel', true)), [
    ['Anna Maria', ''],
    ['Jan', ''],
    ['Eva', 'Smit']
  ]);
  assert.deepEqual(names(parseChildren('Name\nAnna Maria van Bockel\nSex\nFemale', '', true)), [
    ['Anna Maria', 'van Bockel']
  ]);
});

test('saves the pasted two-word surname for sons when enabled', () => {
  const store = new FamilyStore();
  const fatherId = store.addPerson({ name: { given: 'Pieter', surname: 'Bockel' }, sex: 'male' });
  const pasted = parseChildren('Jan van Bockel\nMale', 'Bockel', true);
  const defaultSplit = parseChildren('Gerrit Smit\nMale', 'Bockel');
  const [janId, gerritId] = addChildren(store, { fatherId, children: [...pasted, ...defaultSplit] });
  const { given, surname, birthSurname } = store.getPerson(janId).name;
  assert.deepEqual({ given, surname, birthSurname }, { given: 'Jan', surname: 'van Bockel', birthSurname: 'van Bockel' });
  assert.equal(store.getPerson(gerritId).name.surname, 'Bockel');
  assert.equal(store.getParents(janId)[0].parentId, fatherId);
});
