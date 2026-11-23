import { PARENT_TYPES, SCHEMA_VERSION, SEX_VALUES, UNION_END_REASONS, UNION_TYPES } from './schema.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const optionalString = value => value === null || string(value);
const datePattern = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

function validDate(value) {
  if (value === null) { return true; }
  if (!string(value) || !datePattern.test(value)) { return false; }
  if (value.length !== 10) { return true; }
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function validateFamily(data) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  if (!object(data)) { return [{ path: '$', message: 'Expected an object' }]; }
  if (data.schemaVersion !== SCHEMA_VERSION) { fail('schemaVersion', `Expected version ${SCHEMA_VERSION}`); }
  for (const key of ['people', 'unions', 'places']) {
    if (!object(data[key])) { fail(key, 'Expected an object keyed by ID'); }
  }
  if (!Array.isArray(data.parentChild)) { fail('parentChild', 'Expected an array'); }
  if (errors.length) { return errors; }

  function placeRef(id, path) {
    if (id !== null && (!string(id) || !own(data.places, id))) { fail(path, 'Place does not exist'); }
  }
  function event(value, path) {
    if (!object(value)) { fail(path, 'Expected an event object'); return; }
    if (!validDate(value.date)) { fail(`${path}.date`, 'Expected null, YYYY, YYYY-MM, or a valid YYYY-MM-DD'); }
    placeRef(value.placeId, `${path}.placeId`);
  }
  for (const [key, place] of Object.entries(data.places)) {
    const path = `places.${key}`;
    if (!object(place)) { fail(path, 'Expected an object'); continue; }
    if (place.id !== key) { fail(`${path}.id`, 'ID must match collection key'); }
    if (!string(place.name) || !place.name.trim()) { fail(`${path}.name`, 'Expected a nonempty name'); }
    for (const field of ['latitude', 'longitude']) {
      if (place[field] !== null && (typeof place[field] !== 'number' || !Number.isFinite(place[field]))) {
        fail(`${path}.${field}`, 'Expected a finite number or null');
      }
    }
    if (typeof place.latitude === 'number' && Math.abs(place.latitude) > 90) { fail(`${path}.latitude`, 'Out of range'); }
    if (typeof place.longitude === 'number' && Math.abs(place.longitude) > 180) { fail(`${path}.longitude`, 'Out of range'); }
  }
  for (const [key, person] of Object.entries(data.people)) {
    const path = `people.${key}`;
    if (!object(person)) { fail(path, 'Expected an object'); continue; }
    if (person.id !== key) { fail(`${path}.id`, 'ID must match collection key'); }
    if (!object(person.name)) { fail(`${path}.name`, 'Expected name object'); }
    else {
      if (!string(person.name.given)) { fail(`${path}.name.given`, 'Expected string'); }
      if (!string(person.name.surname)) { fail(`${path}.name.surname`, 'Expected string'); }
      for (const field of ['birthSurname', 'suffix', 'display']) {
        if (!optionalString(person.name[field])) { fail(`${path}.name.${field}`, 'Expected string or null'); }
      }
      if (!String(person.name.given ?? '').trim() && !String(person.name.surname ?? '').trim() && !String(person.name.display ?? '').trim()) {
        fail(`${path}.name`, 'At least one name field must be filled');
      }
    }
    if (person.sex !== null && !SEX_VALUES.includes(person.sex)) { fail(`${path}.sex`, 'Invalid sex value'); }
    event(person.birth, `${path}.birth`);
    event(person.death, `${path}.death`);
    if (!optionalString(person.image)) { fail(`${path}.image`, 'Expected image path or null'); }
    if (!string(person.notes)) { fail(`${path}.notes`, 'Expected string'); }
  }
  for (const [key, union] of Object.entries(data.unions)) {
    const path = `unions.${key}`;
    if (!object(union)) { fail(path, 'Expected an object'); continue; }
    if (union.id !== key) { fail(`${path}.id`, 'ID must match collection key'); }
    if (!UNION_TYPES.includes(union.type)) { fail(`${path}.type`, 'Invalid union type'); }
    if (!Array.isArray(union.partnerIds) || union.partnerIds.length !== 2 || new Set(union.partnerIds).size !== 2) {
      fail(`${path}.partnerIds`, 'Expected two distinct person IDs');
    } else {
      for (const id of union.partnerIds) {
        if (!own(data.people, id)) { fail(`${path}.partnerIds`, `Unknown person ${id}`); }
      }
    }
    event(union.start, `${path}.start`);
    if (union.end !== null) {
      event(union.end, `${path}.end`);
      if (!object(union.end) || !UNION_END_REASONS.includes(union.end.reason)) {
        fail(`${path}.end.reason`, 'Invalid end reason');
      }
    }
  }
  const seen = new Set();
  for (const [index, link] of data.parentChild.entries()) {
    const path = `parentChild.${index}`;
    if (!object(link)) { fail(path, 'Expected an object'); continue; }
    if (!string(link.parentId) || !own(data.people, link.parentId)) { fail(`${path}.parentId`, 'Unknown parent'); }
    if (!string(link.childId) || !own(data.people, link.childId)) { fail(`${path}.childId`, 'Unknown child'); }
    if (link.parentId === link.childId) { fail(path, 'Person cannot be their own parent'); }
    if (!PARENT_TYPES.includes(link.type)) { fail(`${path}.type`, 'Invalid parent relationship type'); }
    if (link.unionId !== null && link.unionId !== undefined && (!string(link.unionId) || !own(data.unions, link.unionId))) {
      fail(`${path}.unionId`, 'Unknown union');
    }
    if (link.unionId && own(data.unions, link.unionId) && !data.unions[link.unionId].partnerIds.includes(link.parentId)) {
      fail(`${path}.unionId`, 'Parent must be a partner in referenced union');
    }
    const fingerprint = JSON.stringify([link.parentId, link.childId, link.type]);
    if (seen.has(fingerprint)) { fail(path, 'Duplicate parent-child relationship'); }
    seen.add(fingerprint);
  }

  // A step relationship does not imply biological/adoptive descent. Other parent
  // edges must form an acyclic directed graph for ancestor traversal to be valid.
  const descendants = new Map();
  for (const link of data.parentChild) {
    if (!object(link) || link.type === 'step' || !string(link.parentId) || !string(link.childId)) { continue; }
    if (!descendants.has(link.parentId)) { descendants.set(link.parentId, []); }
    descendants.get(link.parentId).push(link.childId);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(root) {
    // Iterative traversal avoids call-stack overflow in malformed large data files.
    const stack = [[root, false]];
    while (stack.length) {
      const [id, exit] = stack.pop();
      if (exit) { visiting.delete(id); visited.add(id); continue; }
      if (visited.has(id)) { continue; }
      if (visiting.has(id)) { return id; }
      visiting.add(id);
      stack.push([id, true]);
      for (const child of descendants.get(id) ?? []) { stack.push([child, false]); }
    }
    return null;
  }
  for (const id of Object.keys(data.people)) {
    if (!visited.has(id)) {
      const cycleId = visit(id);
      if (cycleId) { fail('parentChild', `Ancestry cycle detected near ${cycleId}`); break; }
    }
  }
  return errors;
}

export function assertValidFamily(data) {
  const errors = validateFamily(data);
  if (errors.length) {
    throw new FamilyValidationError(errors);
  }
  return data;
}

export class FamilyValidationError extends Error {
  constructor(errors) {
    super(`Invalid family data: ${errors[0].path}: ${errors[0].message}`);
    this.name = 'FamilyValidationError';
    this.errors = errors;
  }
}
