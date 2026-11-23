import { personName } from './graph.js';

export function matchingPeople(people, modified, query = '', excludeId = '') {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = people.filter(p => p.id !== excludeId && terms.every(term =>
    [personName(p), p.name.birthSurname || '', p.birth.date || '', p.death.date || ''].join(' ').toLowerCase().includes(term)
  ));
  matches.sort((a, b) => (modified[b.id] || 0) - (modified[a.id] || 0) || personName(a).localeCompare(personName(b)));
  return terms.length ? matches : matches.slice(0, 5);
}

export function changedPeople(before, after) {
  const ids = new Set();
  for (const [id, person] of Object.entries(after.people)) {
    if (JSON.stringify(before.people[id]) !== JSON.stringify(person)) ids.add(id);
  }
  for (const key of ['parentChild', 'unions']) {
    const oldRows = Object.values(before[key]), newRows = Object.values(after[key]);
    const oldSet = new Set(oldRows.map(row => JSON.stringify(row)));
    const newSet = new Set(newRows.map(row => JSON.stringify(row)));
    for (const row of [...oldRows.filter(row => !newSet.has(JSON.stringify(row))), ...newRows.filter(row => !oldSet.has(JSON.stringify(row)))]) {
      for (const id of row.partnerIds || [row.parentId, row.childId]) if (after.people[id]) ids.add(id);
    }
  }
  return ids;
}

export const PeoplePicker = {
  props: ['modelValue', 'people', 'modified', 'excludeId'],
  emits: ['update:modelValue'],
  data: () => ({ query: '' }),
  computed: {
    selected() { return this.people.find(p => p.id === this.modelValue && p.id !== this.excludeId); },
    results() { return matchingPeople(this.people, this.modified, this.query, this.excludeId); }
  },
  methods: { personName },
  template: `<div class="people-picker">
    <div v-if="selected" class="picker-selected"><span>{{ personName(selected) }}<small>{{ selected.birth.date || 'Birth unknown' }}</small></span><button type="button" class="mini-button" @click="$emit('update:modelValue','');query=''">Change</button></div>
    <template v-else>
      <input v-model="query" class="search" type="search" placeholder="Search people" aria-label="Search existing people" autocomplete="off" />
      <div class="picker-results">
        <button v-for="p in results" :key="p.id" type="button" @click="$emit('update:modelValue',p.id)"><strong>{{ personName(p) }}</strong><small>{{ p.birth.date || 'Birth unknown' }}</small></button>
        <p v-if="!results.length" class="muted">No matches.</p>
      </div>
    </template>
  </div>`
};
