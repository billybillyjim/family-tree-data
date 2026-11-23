export const SCHEMA_VERSION = 1;
export const PARENT_TYPES = Object.freeze(['biological', 'adoptive', 'step', 'unknown']);
export const UNION_TYPES = Object.freeze(['marriage', 'partnership', 'unknown']);
export const SEX_VALUES = Object.freeze(['female', 'male', 'other', 'unknown']);
export const UNION_END_REASONS = Object.freeze(['divorce', 'separation', 'death', 'other', 'unknown']);

export function emptyFamily() {
  return {
    schemaVersion: SCHEMA_VERSION,
    people: {},
    unions: {},
    parentChild: [],
    places: {}
  };
}

export function newPerson(id, input = {}) {
  return {
    id,
    name: {
      given: '', surname: '', birthSurname: null, suffix: null, display: null,
      ...input.name
    },
    sex: null,
    birth: { date: null, placeId: null, ...input.birth },
    death: { date: null, placeId: null, ...input.death },
    image: null,
    notes: '',
    ...Object.fromEntries(Object.entries(input).filter(([key]) => !['id', 'name', 'birth', 'death'].includes(key)))
  };
}
