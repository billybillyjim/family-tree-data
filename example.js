import { FamilyStore } from './src/data/index.js';

const family = new FamilyStore();
const chicago = family.addPlace({ name: 'Chicago, Illinois, USA' });
const john = family.addPerson({ name: { given: 'John William', surname: 'Smith' }, birth: { date: '1940-05-12', placeId: chicago } });
const mary = family.addPerson({ name: { given: 'Mary', surname: 'Jones' } });
const susan = family.addPerson({ name: { given: 'Susan', surname: 'Brown' } });
const child = family.addPerson({ name: { given: 'Alex', surname: 'Smith' } });
family.addUnion({ partnerIds: [john, mary], start: { date: '1962' }, end: { date: '1975', placeId: null, reason: 'divorce' } });
const secondMarriage = family.addUnion({ partnerIds: [john, susan], start: { date: '1978' } });
family.addParentChild({ parentId: john, childId: child, unionId: secondMarriage });
family.addParentChild({ parentId: susan, childId: child, unionId: secondMarriage });
family.addParentChild({ parentId: mary, childId: child, type: 'step' });
console.log('Ancestors:', family.getAncestors(child));
console.log('Second marriage:', family.getUnion(secondMarriage));
console.log('Exportable JSON:\n', family.toJSON());
