import { newPerson } from '../data/schema.js';

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const normalize = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
const pasteLines = text => text.replace(/\\(?=\s*(?:\r?\n|$))/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const labels = new Set(['name', 'sex', 'gender', 'event type', 'event date', 'event place', 'event place (original)', 'birth date', 'birthplace', 'birth place', 'date of birth', 'death date', 'deathplace', 'death place', 'date of death', 'file number', 'affiliate name', 'affiliate repository type', 'employer', 'complexion', 'race', 'height', 'weight', 'eye color', 'hair color', 'affiliate publication number', 'affiliate publication title']);
for (const label of ['death time', 'relationship to head of household', 'age', 'residence date', 'residence place', 'marital status']) labels.add(label);

function validDate(text) {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text)) return '';
  const [year, month = 1, day = 1] = text.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : '';
}

export function recordDate(text) {
  if (!text) return '';
  text = text.trim();
  if (/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text)) return validDate(text);
  const parts = text.toLowerCase().replace(/[,.]/g, '').split(/\s+/);
  let day, month, year;
  if (parts.length === 3 && /^\d{1,2}$/.test(parts[0])) [day, month, year] = parts;
  else if (parts.length === 3) [month, day, year] = parts;
  else if (parts.length === 2) [month, year] = parts;
  const index = months.findIndex(m => m === month || m.slice(0, 3) === month);
  if (index < 0 || !/^\d{4}$/.test(year || '') || (day && !/^\d{1,2}$/.test(day))) {
    return '';
  }
  return validDate(`${year}-${String(index + 1).padStart(2, '0')}${day ? '-' + day.padStart(2, '0') : ''}`);
}

export function personDate(text) {
  if (!text?.trim()) return null;
  const date = recordDate(text);
  if (!date) throw new Error('Enter a valid date, such as 26 May 1821 or 1821-05-26.');
  return date;
}

function profileEvent(lines, kind) {
  const label = new RegExp(`^\\**${kind}\\s*:\\**\\s*`, 'i');
  const index = lines.findIndex(line => label.test(line));
  if (index < 0) return { date: '', place: '' };
  const inline = lines[index].replace(label, '');
  const value = inline || lines[index + 1] || '';
  // FamilySearch can copy the date and place without a space between them.
  const match = value.match(/^(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|[A-Za-z]+\s+\d{4}|\d{4}-\d{2}(?:-\d{2})?|\d{4})(.*)$/);
  const date = match ? recordDate(match[1]) || match[1] : value;
  let place = match ? match[2].trim().replace(/^,\s*/, '') : '';
  if (!place) {
    const next = lines[index + (inline ? 1 : 2)] || '';
    if (next && !/^(?:\**(?:Birth|Death)\s*:|\[|Sources|Memories|Collaborate)/i.test(next)) place = next;
  }
  return { date, place };
}

export function parsePersonEntries(text) {
  const lines = pasteLines(text);
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    const link = lines[index].match(/^(?:[-*]\s+)?\[([^\]]+)\]\([^)]*\/tree\/person\/[A-Z0-9-]+(?:[?#][^)]*)?\)/i);
    const plain = lines[index].replace(/^\*\*|\*\*$/g, '');
    if (link) starts.push({ index, name: link[1].replace(/\*\*/g, '') });
    else if (/^(male|female)$/i.test(lines[index + 1] || '') && !/[:\d]/.test(plain) && !/^sex$/i.test(plain)) starts.push({ index, name: plain });
  }
  return starts.map(({ index, name }, i) => {
    const block = lines.slice(index, starts[i + 1]?.index ?? lines.length);
    const birth = profileEvent(block, 'Birth');
    const death = profileEvent(block, 'Death');
    const sex = block.find(line => /^(male|female)$/i.test(line))?.toLowerCase() || '';
    return { name, sex, birthDate: birth.date, birthPlace: birth.place, deathDate: death.date, deathPlace: death.place, notes: block.join('\n') };
  });
}

export function parseRecord(text) {
  const lines = pasteLines(text);
  const familyStart = lines.findIndex(l => /parents and siblings|parents and family|person details|\s+(?:Father|Mother)(?:\s+[MF])?$/i.test(l));
  const primary = familyStart < 0 ? lines : lines.slice(0, familyStart);
  const field = (...names) => {
    const i = primary.findIndex(l => names.includes(normalize(l).replace(/:$/, '')));
    return i >= 0 && primary[i + 1] && !labels.has(normalize(primary[i + 1]).replace(/:$/, '')) ? primary[i + 1] : '';
  };
  const name = field('name');
  const event = field('event type') || 'Record';
  const sex = value => ({ m: 'male', male: 'male', f: 'female', female: 'female' }[normalize(value)] || '');
  const parents = [];
  // Read relationship rows only, so repeated person detail blocks do not add duplicates.
  const family = familyStart < 0 ? lines.slice(2) : lines.slice(familyStart);
  for (let i = 0; i < family.length; i++) {
    let match = family[i].match(/^(.+?)\s+(Father|Mother)(?:\s+(M|F|Male|Female))?\s*$/i);
    if (!match && /^(Father|Mother)$/i.test(family[i + 1] || '') && !labels.has(normalize(family[i]))) {
      match = [null, family[i], family[i + 1], family[i + 2] || ''];
    }
    if (!match) continue;
    const role = match[2].toLowerCase();
    const parent = { name: match[1].trim(), role, sex: sex(match[3] || '') || (role === 'father' ? 'male' : 'female'), existingId: '' };
    if (!parents.some(p => normalize(p.name) === normalize(parent.name) && p.role === role)) parents.push(parent);
  }
  const date = field('event date');
  const place = field('event place', 'event place (original)');
  const birthDate = field('birth date', 'date of birth');
  const deathDate = field('death date', 'date of death');
  const knownBirth = recordDate(birthDate) || birthDate || (normalize(event) === 'birth' ? recordDate(date) || date : '');
  const age = field('age');
  // Census age belongs to the census date, even when a prior residence is listed.
  const reference = date || field('residence date');
  const referenceDate = recordDate(reference);
  const ageMatch = age.match(/^(\d{1,3})(?:\s+years?(?:\s+old)?)?$/i);
  let estimatedYear = '', birthEstimate = '';
  if (!knownBirth && ageMatch && Number(ageMatch[1]) <= 130 && referenceDate) {
    const year = Number(referenceDate.slice(0, 4)) - Number(ageMatch[1]);
    if (year > 0) {
      estimatedYear = String(year).padStart(4, '0');
      birthEstimate = `Birth year estimated as about ${year} from age ${Number(ageMatch[1])} at ${date ? 'event' : 'residence'} date ${reference}. Possible birth years: ${year - 1} or ${year}.`;
    }
  }
  return {
    name, sex: sex(field('sex', 'gender')), event,
    date: recordDate(date) || date, place,
    birthDate: knownBirth || estimatedYear,
    birthEstimate,
    birthPlace: field('birthplace', 'birth place') || (normalize(event) === 'birth' ? place : ''),
    deathDate: recordDate(deathDate) || deathDate || (normalize(event) === 'death' ? recordDate(date) || date : ''),
    deathPlace: field('deathplace', 'death place') || (normalize(event) === 'death' ? place : ''),
    parents, children: [], notes: text.trim(), existingId: ''
  };
}

export function addPastedRecord(store, record) {
  return store.transaction(data => {
    function person(entry, allowCreate = false) {
      if (entry.existingId) {
        if (!data.people[entry.existingId]) throw new Error('Selected person no longer exists.');
        const existing = data.people[entry.existingId];
        if ((!existing.sex || existing.sex === 'unknown') && entry.sex) existing.sex = entry.sex;
        return entry.existingId;
      }
      if (!allowCreate) throw new Error('Select an existing person for each relative.');
      if (!entry.name?.trim()) throw new Error('A person needs a name.');
      const id = crypto.randomUUID();
      const parts = entry.name.trim().split(/\s+/);
      const surname = parts.length > 1 ? parts.pop() : '';
      data.people[id] = newPerson(id, { name: { given: parts.join(' '), surname, display: entry.name.trim() }, sex: entry.sex || null });
      return id;
    }
    const id = person(record, true), target = data.people[id];
    function fillEvent(kind, rawDate, rawPlace, replaceDate = false) {
      const event = target[kind];
      const date = recordDate(rawDate);
      if (date && (!event.date || replaceDate)) event.date = date;
      const placeName = (rawPlace || '').trim();
      if (placeName && !event.placeId) {
        let place = Object.values(data.places).find(p => normalize(p.name) === normalize(placeName));
        if (!place) {
          const placeId = crypto.randomUUID();
          place = data.places[placeId] = { id: placeId, name: placeName, latitude: null, longitude: null };
        }
        event.placeId = place.id;
      }
    }
    const kind = normalize(record.event || '');
    fillEvent('birth', record.birthDate || (kind === 'birth' ? record.date : ''), record.birthPlace || (kind === 'birth' ? record.place : ''), !record.birthEstimate);
    fillEvent('death', record.deathDate || (kind === 'death' ? record.date : ''), record.deathPlace || (kind === 'death' ? record.place : ''));
    if (!target.sex && record.sex) target.sex = record.sex;
    if (record.notes && !target.notes.includes(record.notes)) target.notes = [target.notes, record.notes].filter(Boolean).join('\n\n');
    // Keep arbitrary events and nonstandard dates without forcing them into birth/death fields.
    const summary = [
      [record.event, record.date, record.place].filter(Boolean).join(' | '),
      record.birthDate || record.birthPlace ? [record.birthEstimate ? 'Birth (estimated)' : 'Birth', record.birthDate, record.birthPlace].filter(Boolean).join(' | ') : '',
      record.birthEstimate || '',
      record.deathDate || record.deathPlace ? ['Death', record.deathDate, record.deathPlace].filter(Boolean).join(' | ') : ''
    ].filter(Boolean).join('\n');
    if (summary && !target.notes.includes(summary)) target.notes = [target.notes, summary].filter(Boolean).join('\n\n');
    for (const [relatives, isParent] of [[record.parents || [], true], [record.children || [], false]]) {
      for (const relative of relatives) {
        const relativeId = person(relative);
        const parentId = isParent ? relativeId : id;
        const childId = isParent ? id : relativeId;
        if (!data.parentChild.some(l => l.parentId === parentId && l.childId === childId)) {
          data.parentChild.push({ parentId, childId, type: 'unknown' });
        }
      }
    }
    return id;
  });
}
