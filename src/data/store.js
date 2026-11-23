import { emptyFamily, newPerson } from './schema.js';
import { assertValidFamily } from './validate.js';
import { buildIndexes, traverseFamily } from './indexes.js';

const copy = value => structuredClone(value);
const idFactory = () => crypto.randomUUID();
function requireRecord(collection, id, noun) {
  if (!Object.hasOwn(collection, id)) { throw new Error(`${noun} not found: ${id}`); }
}
function mergeEvent(previous, changes) {
  return changes === undefined ? previous : { ...previous, ...changes };
}

export class FamilyStore {
  #data;
  #indexes;
  #makeId;

  constructor(data = emptyFamily(), { makeId = idFactory } = {}) {
    this.#data = copy(assertValidFamily(data));
    this.#indexes = buildIndexes(this.#data);
    this.#makeId = makeId;
  }

  snapshot() { return copy(this.#data); }
  toJSON(space = 2) { return JSON.stringify(this.#data, null, space); }
  static fromJSON(json) { return new FamilyStore(JSON.parse(json)); }
  getPerson(id) { return this.#data.people[id] ? copy(this.#data.people[id]) : null; }
  getPlace(id) { return this.#data.places[id] ? copy(this.#data.places[id]) : null; }
  getUnion(id) { return this.#data.unions[id] ? copy(this.#data.unions[id]) : null; }
  getParents(id, types) {
    const links = this.#indexes.parentsByChild.get(id) ?? [];
    return copy(types ? links.filter(link => types.includes(link.type)) : links);
  }
  getChildren(id, types) {
    const links = this.#indexes.childrenByParent.get(id) ?? [];
    return copy(types ? links.filter(link => types.includes(link.type)) : links);
  }
  getUnions(id) { return copy(this.#indexes.unionsByPerson.get(id) ?? []); }
  getAncestors(id, types) {
    requireRecord(this.#data.people, id, 'Person');
    return traverseFamily(id, this.#indexes.parentsByChild, 'parentId', types);
  }
  getDescendants(id, types) {
    requireRecord(this.#data.people, id, 'Person');
    return traverseFamily(id, this.#indexes.childrenByParent, 'childId', types);
  }

  // A transaction is atomic: an invalid edit leaves the original data untouched.
  transaction(change) {
    const next = copy(this.#data);
    const result = change(next);
    assertValidFamily(next);
    this.#data = next;
    this.#indexes = buildIndexes(next);
    return result;
  }

  addPerson(input) {
    const id = input.id ?? this.#makeId();
    this.transaction(data => {
      if (Object.hasOwn(data.people, id)) { throw new Error(`Person ID already exists: ${id}`); }
      data.people[id] = newPerson(id, input);
    });
    return id;
  }
  editPerson(id, changes) {
    if (changes.id !== undefined && changes.id !== id) { throw new Error('Cannot change a person ID'); }
    this.transaction(data => {
      requireRecord(data.people, id, 'Person');
      const previous = data.people[id];
      data.people[id] = {
        ...previous, ...changes, id,
        name: { ...previous.name, ...changes.name },
        birth: mergeEvent(previous.birth, changes.birth),
        death: mergeEvent(previous.death, changes.death)
      };
    });
  }
  removePerson(id, { cascade = false } = {}) {
    this.transaction(data => {
      requireRecord(data.people, id, 'Person');
      const unionIds = new Set(Object.values(data.unions).filter(u => u.partnerIds.includes(id)).map(u => u.id));
      const used = unionIds.size || data.parentChild.some(l => l.parentId === id || l.childId === id);
      if (used && !cascade) { throw new Error('Person has relationships; use cascade: true to remove them'); }
      for (const unionId of unionIds) { delete data.unions[unionId]; }
      data.parentChild = data.parentChild.filter(l => l.parentId !== id && l.childId !== id && !unionIds.has(l.unionId));
      delete data.people[id];
    });
  }

  addUnion(input) {
    const id = input.id ?? this.#makeId();
    this.transaction(data => {
      if (Object.hasOwn(data.unions, id)) { throw new Error(`Union ID already exists: ${id}`); }
      data.unions[id] = {
        id, partnerIds: input.partnerIds, type: input.type ?? 'marriage',
        start: { date: null, placeId: null, ...input.start },
        end: input.end == null ? null : { date: null, placeId: null, reason: 'unknown', ...input.end }
      };
    });
    return id;
  }
  editUnion(id, changes) {
    if (changes.id !== undefined && changes.id !== id) { throw new Error('Cannot change a union ID'); }
    this.transaction(data => {
      requireRecord(data.unions, id, 'Union');
      const prior = data.unions[id];
      data.unions[id] = {
        ...prior, ...changes, id,
        start: mergeEvent(prior.start, changes.start),
        end: changes.end === undefined ? prior.end : (changes.end === null ? null : { date: null, placeId: null, reason: 'unknown', ...prior.end, ...changes.end })
      };
    });
  }
  removeUnion(id) {
    this.transaction(data => {
      requireRecord(data.unions, id, 'Union');
      delete data.unions[id];
      // Children remain related to their parents even if a marriage record is deleted.
      for (const link of data.parentChild) {
        if (link.unionId === id) { delete link.unionId; }
      }
    });
  }

  addParentChild(input) {
    const link = { parentId: input.parentId, childId: input.childId, type: input.type ?? 'biological' };
    if (input.unionId != null) { link.unionId = input.unionId; }
    this.transaction(data => { data.parentChild.push(link); });
  }
  editParentChild(parentId, childId, type, changes) {
    this.transaction(data => {
      const index = data.parentChild.findIndex(l => l.parentId === parentId && l.childId === childId && l.type === type);
      if (index === -1) { throw new Error('Parent-child relationship not found'); }
      const next = { ...data.parentChild[index], ...changes };
      if (next.unionId == null) { delete next.unionId; }
      data.parentChild[index] = next;
    });
  }
  removeParentChild(parentId, childId, type) {
    this.transaction(data => {
      const index = data.parentChild.findIndex(l => l.parentId === parentId && l.childId === childId && l.type === type);
      if (index === -1) { throw new Error('Parent-child relationship not found'); }
      data.parentChild.splice(index, 1);
    });
  }

  addPlace(input) {
    const id = input.id ?? this.#makeId();
    this.transaction(data => {
      if (Object.hasOwn(data.places, id)) { throw new Error(`Place ID already exists: ${id}`); }
      data.places[id] = { id, name: input.name, latitude: input.latitude ?? null, longitude: input.longitude ?? null };
    });
    return id;
  }
  editPlace(id, changes) {
    if (changes.id !== undefined && changes.id !== id) { throw new Error('Cannot change a place ID'); }
    this.transaction(data => {
      requireRecord(data.places, id, 'Place');
      data.places[id] = { ...data.places[id], ...changes, id };
    });
  }
  removePlace(id, { clearReferences = false } = {}) {
    this.transaction(data => {
      requireRecord(data.places, id, 'Place');
      const events = [
        ...Object.values(data.people).flatMap(p => [p.birth, p.death]),
        ...Object.values(data.unions).flatMap(u => [u.start, u.end].filter(Boolean))
      ];
      const refs = events.filter(event => event.placeId === id);
      if (refs.length && !clearReferences) { throw new Error('Place is in use; use clearReferences: true'); }
      for (const event of refs) { event.placeId = null; }
      delete data.places[id];
    });
  }
}
