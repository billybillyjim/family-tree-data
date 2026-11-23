import { newPerson } from '../data/schema.js';
import { parsePersonEntries, parseRecord, personDate } from './paste.js';

export const blankChild = () => ({ given: '', sex: '', surname: '', pastedSurname: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', notes: '' });

export function parseChildren(text, fatherSurname = '', twoWordSurname = false) {
  const suffix = fatherSurname.trim();
  const fatherSurnameWords = suffix.split(/\s+/).length;
  function rowFor(fullName, sex, birthDate, birthPlace, deathDate, deathPlace, notes) {
    const name = fullName.trim();
    const parts = name.split(/\s+/);
    const surnameWords = Math.min(twoWordSurname ? 2 : 1, parts.length - 1);
    let given, surname, pastedSurname;
    if (suffix && fatherSurnameWords >= surnameWords && name.toLowerCase().endsWith(' ' + suffix.toLowerCase())) {
      given = name.slice(0, -suffix.length).trim(); surname = '';
      pastedSurname = name.slice(-suffix.length);
    } else {
      surname = parts.splice(parts.length - surnameWords).join(' ');
      given = parts.join(' ');
      pastedSurname = surname;
    }
    return {
      ...blankChild(), given, sex, surname: sex === 'female' ? surname : '',
      pastedSurname: twoWordSurname ? pastedSurname : '', birthDate, birthPlace, deathDate, deathPlace, notes
    };
  }
  const entries = parsePersonEntries(text);
  if (!entries.length) {
    const record = parseRecord(text);
    if (!record.name) throw new Error('No child names found. Paste a FamilySearch person entry or a record beginning with Name.');
    return [rowFor(record.name, record.sex, record.birthDate, record.birthPlace, record.deathDate, record.deathPlace, text.trim())];
  }
  return entries.map(({ name, sex, birthDate, birthPlace, deathDate, deathPlace, notes }) => rowFor(name, sex, birthDate, birthPlace, deathDate, deathPlace, notes));
}

export function addChildren(store, { fatherId, motherId = '', children }) {
  return store.transaction(data => {
    const father = data.people[fatherId];
    if (!father) throw new Error('Select an existing father.');
    const surname = father.name.surname.trim();
    if (!surname) throw new Error('The father needs a surname.');
    if (motherId && (!data.people[motherId] || motherId === fatherId)) throw new Error('Select a different existing person as the mother.');
    const rows = children.map((row, index) => ({ row, index })).filter(({ row }) => Object.values(row).some(value => typeof value === 'string' && value.trim()));
    if (!rows.length) throw new Error('Add at least one child.');
    function placeId(value) {
      const name = value.trim();
      if (!name) return null;
      const existing = Object.values(data.places).find(place => place.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing.id;
      const id = crypto.randomUUID();
      data.places[id] = { id, name, latitude: null, longitude: null };
      return id;
    }
    const union = motherId ? Object.values(data.unions).find(u => u.partnerIds.includes(fatherId) && u.partnerIds.includes(motherId)) : null;
    return rows.map(({ row, index }) => {
      try {
        if (!row.given.trim()) throw new Error('Enter given names.');
        if (!['male', 'female'].includes(row.sex)) throw new Error('Select male or female.');
        const id = crypto.randomUUID();
        const birthSurname = row.sex === 'male' ? row.pastedSurname?.trim() || surname : surname;
        const childSurname = row.sex === 'male' ? birthSurname : row.surname.trim() || surname;
        data.people[id] = newPerson(id, {
          name: { given: row.given.trim(), surname: childSurname, birthSurname },
          sex: row.sex,
          birth: { date: personDate(row.birthDate), placeId: placeId(row.birthPlace) },
          death: { date: personDate(row.deathDate), placeId: placeId(row.deathPlace) },
          notes: row.notes || ''
        });
        for (const parentId of [fatherId, motherId].filter(Boolean)) data.parentChild.push({ parentId, childId: id, type: 'unknown', ...(union ? { unionId: union.id } : {}) });
        return id;
      } catch (error) { throw new Error(`Child ${index + 1}: ${error.message}`); }
    });
  });
}
