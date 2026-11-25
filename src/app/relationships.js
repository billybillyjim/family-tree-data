export function personRelationships(data, id) {
  return {
    parents: data.parentChild.filter(link => link.childId === id),
    children: data.parentChild.filter(link => link.parentId === id),
    unions: Object.values(data.unions).filter(union => union.partnerIds.includes(id))
  };
}

export function recordedChildIds(data, parentId) {
  return new Set(data.parentChild.filter(link => link.parentId === parentId).map(link => link.childId));
}

export function relationshipRole(person, direction) {
  if (direction === 'parent') {
    return person?.sex === 'female' ? 'Mother' : person?.sex === 'male' ? 'Father' : 'Parent';
  }
  return person?.sex === 'female' ? 'Daughter' : person?.sex === 'male' ? 'Son' : 'Child';
}

// Actions read from the selected person to the person that was right-clicked.
export function createQuickRelationship(store, selectedId, otherId, action) {
  if (!store.getPerson(selectedId) || !store.getPerson(otherId)) throw new Error('Both people must exist.');
  if (selectedId === otherId) throw new Error('Choose a different person.');
  if (action === 'married') {
    if (store.getUnions(selectedId).some(u => u.type === 'marriage' && u.partnerIds.includes(otherId))) return false;
    store.addUnion({ partnerIds: [selectedId, otherId], type: 'marriage' });
  } else if (action === 'parent' || action === 'child') {
    const parentId = action === 'parent' ? selectedId : otherId;
    const childId = action === 'parent' ? otherId : selectedId;
    if (store.getParents(childId).some(link => link.parentId === parentId)) return false;
    store.addParentChild({ parentId, childId, type: 'unknown' });
  } else {
    throw new Error('Unknown relationship action.');
  }
  return true;
}

export function relativeCreation(person, role) {
  const kinds = { father: 'parent', mother: 'parent', daughter: 'child', son: 'child', wife: 'spouse', husband: 'spouse' };
  const kind = kinds[role];
  if (!person || !kind) throw new Error('Choose a person and a valid relative role.');
  const sex = ['father', 'son', 'husband'].includes(role) ? 'male' : 'female';
  const surname = role === 'father' ? person.name.birthSurname || person.name.surname
    : kind === 'child' && person.sex === 'male' ? person.name.surname : '';
  return { ownerId: person.id, role, kind, form: { sex, surname }, ...(kind === 'spouse' ? { childIds: [] } : {}) };
}

export function linkCreatedRelative(data, newId, creation, makeId = () => crypto.randomUUID()) {
  if (!data.people[creation.ownerId] || !data.people[newId]) throw new Error('Both people must exist before creating the relationship.');
  if (creation.kind === 'spouse') {
    const childIds = new Set(creation.childIds);
    const existingChildren = recordedChildIds(data, creation.ownerId);
    for (const childId of childIds) {
      if (!existingChildren.has(childId)) throw new Error('A selected child is no longer linked to this person.');
    }
    const id = makeId();
    data.unions[id] = { id, partnerIds: [creation.ownerId, newId], type: 'marriage', start: { date: null, placeId: null }, end: null };
    for (const childId of childIds) {
      data.parentChild.push({ parentId: newId, childId, type: 'unknown', unionId: id });
    }
  } else if (creation.kind === 'parent' || creation.kind === 'child') {
    data.parentChild.push({
      parentId: creation.kind === 'parent' ? newId : creation.ownerId,
      childId: creation.kind === 'parent' ? creation.ownerId : newId,
      type: 'unknown'
    });
  } else throw new Error('Unknown relative role.');
}
