import { FamilyStore } from '../data/index.js';
import { buildLayout, getLineage, getMissingDataHighlights, personName } from './graph.js';
import { GraphCanvas } from './canvas.js';
import { birthOrder } from './family-layout.js';
import { buildForceLayout } from './force-layout.js';
import { buildTimelineLayout } from './timeline-layout.js';
import { surnameLegend } from './surname-colors.js';
import { explainRelationship } from './kinship.js';
import { loadDraft, loadModified, saveDraft, downloadJson } from './persistence.js';
import { parsePersonEntries, parseRecord, addPastedRecord, personDate } from './paste.js';
import { personRelationships, recordedChildIds, relationshipRole, createQuickRelationship, relativeCreation, linkCreatedRelative } from './relationships.js';
import { PeoplePicker, changedPeople } from './people-picker.js';
import { blankChild, parseChildren, addChildren } from './children.js';

const { createApp, ref, computed, watch, onMounted, onBeforeUnmount, nextTick, toRaw } = Vue;
const blankForm = () => ({ given: '', surname: '', birthSurname: '', suffix: '', display: '', sex: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', image: '', notes: '' });
const blankRelationship = () => ({ otherId: '', type: 'biological', start: '', end: '', endReason: 'divorce' });

createApp({
  components: { PeoplePicker },
  setup() {
    let store = new FamilyStore();
    let revision = 0;
    let draftTimer;
    const snapshot = ref(store.snapshot());
    const modifiedPeople = ref({});
    const history = ref([]), future = ref([]);
    const search = ref(''), selectedId = ref(null), panel = ref(''), tab = ref('details');
    const form = ref(blankForm());
    const bulkOpen = ref(false), bulkElement = ref(null), bulkFatherId = ref(''), bulkMotherId = ref(''), bulkMotherEnabled = ref(false);
    const bulkRows = ref([blankChild()]), bulkText = ref(''), bulkError = ref('');
    const bulkTwoWordSurname = ref(false);
    const bulkFatherSurname = computed(() => snapshot.value.people[bulkFatherId.value]?.name.surname || '');
    let bulkTrigger = null;
    function focusBulkName(index = 0) {
      nextTick(() => bulkElement.value?.querySelector(`[data-child-name="${index}"]`)?.focus());
    }
    function openBulkChildren() {
      const owner = snapshot.value.people[selectedId.value];
      if (!owner) return;
      bulkTrigger = document.activeElement;
      closeContextMenu();
      const partners = [...new Set(Object.values(snapshot.value.unions).filter(u => !u.end && u.partnerIds.includes(owner.id)).flatMap(u => u.partnerIds.filter(id => id !== owner.id)))].map(id => snapshot.value.people[id]);
      const candidates = partners.filter(p => p.sex === (owner.sex === 'female' ? 'male' : 'female'));
      bulkFatherId.value = owner.sex === 'female' ? (candidates.length === 1 ? candidates[0].id : '') : owner.id;
      bulkMotherId.value = owner.sex === 'female' ? owner.id : (candidates.length === 1 ? candidates[0].id : '');
      bulkMotherEnabled.value = !!bulkMotherId.value;
      bulkRows.value = [blankChild()]; bulkText.value = ''; bulkError.value = ''; bulkOpen.value = true;
      if (bulkFatherId.value) focusBulkName();
      else nextTick(() => bulkElement.value?.querySelector('input[type="search"]')?.focus());
    }
    function closeBulkChildren() {
      bulkOpen.value = false;
      nextTick(() => { if (bulkTrigger?.isConnected) bulkTrigger.focus(); });
    }
    function addBulkRow() { bulkRows.value.push(blankChild()); focusBulkName(bulkRows.value.length - 1); }
    function fillBulkRows() {
      try {
        const parsed = parseChildren(bulkText.value, bulkFatherSurname.value, bulkTwoWordSurname.value);
        const existing = bulkRows.value.filter(row => Object.values(row).some(value => value.trim()));
        bulkRows.value = [...existing, ...parsed]; bulkText.value = ''; bulkError.value = '';
        focusBulkName(existing.length);
      } catch (error) { bulkError.value = error.message; }
    }
    function saveBulkChildren() {
      bulkError.value = '';
      const result = commit(() => {
        try { return addChildren(store, { fatherId: bulkFatherId.value, motherId: bulkMotherEnabled.value ? bulkMotherId.value : '', children: bulkRows.value }); }
        catch (error) { bulkError.value = error.message; throw error; }
      });
      if (result) {
        closeBulkChildren(); selectPerson(bulkFatherId.value, false, 'relationships'); fitGraph();
        notify(`${result.length} children added.`);
      }
    }
    function bulkKeys(event) {
      if (event.key === 'Escape') { event.preventDefault(); closeBulkChildren(); return; }
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); return; }
      if (event.key !== 'Tab') return;
      const fields = [...bulkElement.value.querySelectorAll('button,input,select,textarea,summary')].filter(field => !field.disabled && field.offsetParent !== null);
      if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
    }
    const pendingCreation = ref(null);
    const spouseChildren = computed(() => {
      const creation = pendingCreation.value;
      if (creation?.kind !== 'spouse') return [];
      const family = snapshot.value;
      return [...recordedChildIds(family, creation.ownerId)].map(id => family.people[id]).sort(birthOrder);
    });
    const givenNameInput = ref(null);
    const relativePasteInput = ref(null), relativePasteText = ref(''), relativePasteError = ref('');
    let createPersonTrigger = null;
    function personEditorKeys(event) {
      if (panel.value !== 'new') return;
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
      if (event.key !== 'Tab') return;
      const fields = [...event.currentTarget.querySelectorAll('button,input,select,textarea')].filter(field => !field.disabled && field.offsetParent !== null);
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    const contextMenu = ref(null), contextMenuElement = ref(null);
    const relationshipExplanation = ref(null), relationshipDialog = ref(null);
    function closeContextMenu() { contextMenu.value = null; }
    function openContextMenu(otherId, event) {
      closeContextMenu();
      if (!event || !selectedId.value || !snapshot.value.people[selectedId.value] || !snapshot.value.people[otherId]) return false;
      contextMenu.value = { mode: selectedId.value === otherId ? 'create' : 'link', selectedId: selectedId.value, otherId, x: event.clientX, y: event.clientY };
      nextTick(() => {
        if (!contextMenu.value || !contextMenuElement.value) return;
        const rect = contextMenuElement.value.getBoundingClientRect();
        contextMenu.value.x = Math.max(8, Math.min(contextMenu.value.x, window.innerWidth - rect.width - 8));
        contextMenu.value.y = Math.max(8, Math.min(contextMenu.value.y, window.innerHeight - rect.height - 8));
        contextMenuElement.value.querySelector('button')?.focus({ preventScroll: true });
      });
      return true;
    }
    function saveContextRelationship(action) {
      const pair = contextMenu.value;
      closeContextMenu();
      if (!pair) return;
      const result = commit(() => ({ created: createQuickRelationship(store, pair.selectedId, pair.otherId, action) }));
      if (result) {
        tab.value = 'relationships';
        notify(result.created ? 'Relationship saved.' : 'Relationship already exists.');
      }
    }
    function explainContextRelationship() {
      const pair = contextMenu.value;
      if (pair?.mode !== 'link') return;
      closeContextMenu();
      relationshipExplanation.value = explainRelationship(snapshot.value, pair.selectedId, pair.otherId);
      nextTick(() => relationshipDialog.value?.showModal());
    }
    function createContextRelative(role) {
      const owner = snapshot.value.people[contextMenu.value?.selectedId];
      closeContextMenu();
      if (!owner) return;
      const creation = relativeCreation(owner, role);
      createPerson();
      pendingCreation.value = creation;
      Object.assign(form.value, creation.form);
    }
    function fillRelativeForm() {
      const text = relativePasteText.value.trim();
      const entries = parsePersonEntries(text);
      if (entries.length !== 1 || !entries[0].name.trim()) {
        relativePasteError.value = 'Paste one FamilySearch person entry with a name.';
        return;
      }
      const { name, sex, birthDate, birthPlace, deathDate, deathPlace } = entries[0];
      const parts = name.trim().split(/\s+/);
      const pastedSurname = parts.length > 1 ? parts.pop() : '';
      const creation = pendingCreation.value;
      const isWife = creation.role === 'wife';
      const husbandSurname = isWife ? snapshot.value.people[creation.ownerId]?.name.surname : '';
      Object.assign(form.value, {
        given: parts.join(' '), surname: husbandSurname || pastedSurname, sex: sex || creation.form.sex,
        birthDate, birthPlace, deathDate, deathPlace, notes: text
      });
      if (isWife) form.value.birthSurname = pastedSurname;
      relativePasteError.value = '';
      givenNameInput.value?.focus();
    }
    function dismissContextMenu(event) {
      if (!contextMenuElement.value?.contains(event.target)) closeContextMenu();
    }
    function contextEscape(event) {
      if (event.key === 'Escape') closeContextMenu();
    }
    function contextMenuKeys(event) {
      const buttons = [...contextMenuElement.value.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
      if (event.key === 'Tab') closeContextMenu();
    }
    const pasteOpen = ref(false), pastedText = ref(''), pastedRecord = ref(null), pasteError = ref('');
    const pastedRelatives = computed(() => pastedRecord.value ? [...pastedRecord.value.parents, ...pastedRecord.value.children] : []);
    function addPasteRelative(role) {
      const list = ['mother', 'father'].includes(role) ? pastedRecord.value.parents : pastedRecord.value.children;
      list.push({ role, name: '', existingId: '', sex: ['mother', 'daughter'].includes(role) ? 'female' : 'male' });
    }
    function removePasteRelative(relative) {
      for (const list of [pastedRecord.value.parents, pastedRecord.value.children]) {
        const index = list.indexOf(relative);
        if (index >= 0) list.splice(index, 1);
      }
    }
    function openPaste() { pasteOpen.value = true; pasteError.value = ''; }
    function reviewPaste() {
      try { pastedRecord.value = parseRecord(pastedText.value); pasteError.value = ''; }
      catch (err) { pastedRecord.value = null; pasteError.value = err.message; }
    }
    function savePaste() {
      if (pastedRelatives.value.some(p => !p.existingId)) { notify('Select an existing person for each relative.', true); return; }
      const id = commit(() => addPastedRecord(store, pastedRecord.value));
      if (id) {
        pasteOpen.value = false; pastedText.value = ''; pastedRecord.value = null;
        selectPerson(id, true);
      }
    }
    const relationModal = ref(null), editingUnionId = ref(null), relationship = ref(blankRelationship());
    const lineageMode = ref('none'), targetId = ref('');
    const missingHighlights = computed(() => getMissingDataHighlights(snapshot.value, lineageMode.value));
    const graphCanvas = ref(null);
    const saveStatus = ref('Loading…'), saveError = ref(false);
    const message = ref(''), messageError = ref(false);
    let graph = null;
    const graphRef = ref(null);
    const layoutMode = ref('elk'), layoutPending = ref(false);
    const forceAutoEase = ref(false);
    const showSiblingLinks = ref(true), showMarriageLinks = ref(true);
    const layoutError = ref('');
    const cardColors = ref('default');
    const surnameLegendEntries = computed(() => cardColors.value === 'surname' ? surnameLegend(snapshot.value.people) : []);
    let layoutWorker, layoutRequest = 0, layoutTimer, afterLayout;
    const selectedPerson = computed(() => selectedId.value ? snapshot.value.people[selectedId.value] || null : null);
    const sortedPeople = computed(() => Object.values(snapshot.value.people).sort((a, b) => personName(a).localeCompare(personName(b))));
    const filteredPeople = computed(() => {
      const term = search.value.trim().toLowerCase();
      if (!term) { return sortedPeople.value; }
      return sortedPeople.value.filter(p => [personName(p), p.name.birthSurname || '', p.birth.date || '', p.death.date || ''].join(' ').toLowerCase().includes(term));
    });
    const relationships = computed(() => personRelationships(snapshot.value, selectedId.value));
    const parents = computed(() => relationships.value.parents);
    const children = computed(() => relationships.value.children);
    const unions = computed(() => relationships.value.unions);
    const roleById = (id, direction) => relationshipRole(snapshot.value.people[id], direction);
    const ancestorCount = computed(() => selectedId.value && selectedPerson.value ? store.getAncestors(selectedId.value).length : 0);
    const descendantCount = computed(() => selectedId.value && selectedPerson.value ? store.getDescendants(selectedId.value).length : 0);
    const personCount = computed(() => Object.keys(snapshot.value.people).length);
    const unionCount = computed(() => Object.keys(snapshot.value.unions).length);
    const linkCount = computed(() => snapshot.value.parentChild.length);
    const initialsFromForm = computed(() => (form.value.given.slice(0,1) + form.value.surname.slice(0,1)).toUpperCase() || '?');
    const fullName = personName;
    const initials = p => (p.name.given[0] || '') + (p.name.surname[0] || '') || '?';
    const nameById = id => snapshot.value.people[id] ? personName(snapshot.value.people[id]) : 'Unknown';
    function saveJsonFile() { downloadJson(store.toJSON()); }
    function notify(text, error = false) { message.value = text; messageError.value = error; }
    function moveGraph(move) {
      if (layoutPending.value) afterLayout = move;
      else if (graph) move(graph);
    }
    function fitGraph() { moveGraph(canvas => canvas.fit()); }
    function focusGraph(id) { moveGraph(canvas => canvas.focus(id)); }
    function changeLayout(event) {
      if (layoutPending.value) {
        layoutWorker?.terminate();
        layoutWorker = null;
      }
      layoutMode.value = event.target.value;
      updateGraph(true);
    }
    function updateGraph(shouldFit = false) {
      if (!graph) { return; }
      const family = toRaw(snapshot.value);
      const mode = layoutMode.value;
      const request = ++layoutRequest;
      clearTimeout(layoutTimer);
      if (shouldFit) layoutError.value = '';
      if (shouldFit) afterLayout = canvas => canvas.fit();
      function show(layout) {
        if (request !== layoutRequest) return;
        clearTimeout(layoutTimer);
        layoutPending.value = false;
        graph.setData(family, layout);
        highlight();
        const move = afterLayout;
        afterLayout = null;
        move?.(graph);
      }
      function useOriginal(reason) {
        if (request !== layoutRequest) return;
        layoutWorker?.terminate();
        layoutWorker = null;
        layoutError.value = `${mode === 'stress' ? 'ELK Stress' : 'ELK Layered'}: ${reason} Showing Original.`;
        layoutMode.value = 'original';
        show(buildLayout(family));
      }
      if (['original', 'original-horizontal', 'generations', 'timeline', 'force'].includes(mode) || !Object.keys(family.people).length) {
        if (layoutPending.value) {
          layoutWorker?.terminate();
          layoutWorker = null;
        }
        if (mode === 'force') {
          show(buildForceLayout(family, {
            animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
            previousNodes: graph.layout?.forceLinks ? graph.layout.nodes : undefined,
            showSiblings: showSiblingLinks.value,
            showMarriages: showMarriageLinks.value
          }));
          return;
        }
        show(mode === 'timeline' ? buildTimelineLayout(family) : buildLayout(family, {
          horizontal: mode === 'original-horizontal',
          fromYoungest: mode === 'generations'
        }));
        return;
      }
      if (mode === 'stress' && layoutPending.value) {
        layoutWorker?.terminate();
        layoutWorker = null;
      }
      layoutPending.value = true;
      try {
        layoutWorker ??= new Worker(new URL('./elk-worker.js', import.meta.url));
        layoutWorker.onmessage = ({ data }) => {
          if (data.request !== request || request !== layoutRequest) return;
          if (data.started) {
            if (mode === 'stress') clearTimeout(layoutTimer);
          } else if (data.layout) {
            show(data.layout);
          } else {
            useOriginal(data.error || 'The worker returned no layout.');
          }
        };
        layoutWorker.onerror = event => useOriginal(event.message || 'The layout worker stopped.');
        layoutWorker.onmessageerror = () => useOriginal('The layout could not be read.');
        layoutTimer = setTimeout(() => useOriginal(mode === 'stress'
          ? 'The worker did not start within 15 seconds.'
          : 'The layout did not finish within 15 seconds.'), 15000);
        layoutWorker.postMessage({ request, family, mode });
      } catch (error) {
        useOriginal(error.message || 'The layout worker could not start.');
      }
    }
    function highlight() {
      if (!graph) { return; }
      const mode = lineageMode.value;
      if (missingHighlights.value) {
        graph.setSelection(selectedId.value, missingHighlights.value, { missingData: true });
        return;
      }
      const ids = selectedPerson.value && mode !== 'none' ? getLineage(store, selectedId.value, mode, ['biological','adoptive','unknown'], targetId.value) : null;
      graph.setSelection(selectedId.value, ids);
    }
    function commit(operation) {
      const before = store.toJSON();
      try {
        const result = operation();
        if (store.toJSON() === before) { return result; }
        history.value = [...history.value.slice(-19), before];
        future.value = [];
        refresh();
        return result;
      } catch (err) {
        notify(err.errors ? `${err.errors[0].path}: ${err.errors[0].message}` : err.message, true);
        return null;
      }
    }
    function refresh(fit = false) {
      revision++;
      const next = store.snapshot();
      const changed = changedPeople(snapshot.value, next);
      const modified = { ...modifiedPeople.value };
      const timestamp = Object.values(modified).reduce((latest, value) => Math.max(latest, value + 1), Date.now());
      for (const id of changed) modified[id] = timestamp;
      for (const id of Object.keys(modified)) if (!next.people[id]) delete modified[id];
      modifiedPeople.value = modified;
      snapshot.value = next;
      updateGraph(fit);
      saveStatus.value = 'Unsaved draft…'; saveError.value = false;
      clearTimeout(draftTimer);
      const currentRevision = revision;
      draftTimer = setTimeout(async () => {
        try {
          await saveDraft(store.toJSON(), { ...modifiedPeople.value });
          if (currentRevision === revision) { saveStatus.value = 'Saved locally'; }
        } catch (err) { saveStatus.value = 'Local save failed'; saveError.value = true; notify(err.message, true); }
      }, 300);
    }
    function undo() {
      if (!history.value.length) { return; }
      const json = history.value.pop(); future.value.push(store.toJSON());
      store = FamilyStore.fromJSON(json); refresh(); hydrateForm();
    }
    function redo() {
      if (!future.value.length) { return; }
      const json = future.value.pop(); history.value.push(store.toJSON());
      store = FamilyStore.fromJSON(json); refresh(); hydrateForm();
    }
    function hydrateForm() {
      const p = selectedPerson.value;
      if (!p) { form.value = blankForm(); return; }
      const place = id => snapshot.value.places[id]?.name || '';
      form.value = {
        given: p.name.given, surname: p.name.surname, birthSurname: p.name.birthSurname || '', suffix: p.name.suffix || '', display: p.name.display || '',
        sex: p.sex || '', birthDate: p.birth.date || '', deathDate: p.death.date || '', birthPlace: place(p.birth.placeId), deathPlace: place(p.death.placeId), image: p.image || '', notes: p.notes || ''
      };
    }
    function selectPerson(id, focus = false, selectedTab = 'details') {
      if (!snapshot.value.people[id]) { return; }
      selectedId.value = id; panel.value = 'edit'; tab.value = selectedTab;
      hydrateForm(); highlight();
      if (focus) { focusGraph(id); }
    }
    function closePanel() {
      const wasNew = panel.value === 'new';
      const ownerId = pendingCreation.value?.ownerId;
      pendingCreation.value = null;
      selectedId.value = null; panel.value = ''; highlight();
      if (wasNew && snapshot.value.people[ownerId]) selectPerson(ownerId);
      if (wasNew) nextTick(() => { if (createPersonTrigger?.isConnected) createPersonTrigger.focus(); });
    }
    function createPerson() {
      createPersonTrigger = document.activeElement;
      pendingCreation.value = null;
      relativePasteText.value = ''; relativePasteError.value = '';
      selectedId.value = null; panel.value = 'new'; tab.value = 'details'; form.value = blankForm(); highlight();
      nextTick(() => { if (panel.value === 'new') (relativePasteInput.value || givenNameInput.value)?.focus(); });
    }
    function ensurePlace(data, name) {
      const n = name.trim();
      if (!n) { return null; }
      const existing = Object.values(data.places).find(p => p.name.toLocaleLowerCase() === n.toLocaleLowerCase());
      if (existing) { return existing.id; }
      const id = crypto.randomUUID();
      data.places[id] = { id, name: n, latitude: null, longitude: null };
      return id;
    }
    function savePerson() {
      const f = form.value;
      if (!f.given.trim() && !f.surname.trim() && !f.display.trim()) { notify('A person needs a name.', true); return; }
      const currentId = panel.value === 'new' ? crypto.randomUUID() : selectedId.value;
      const created = panel.value === 'new';
      const result = commit(() => store.transaction(data => {
        const birthPlaceId = ensurePlace(data, f.birthPlace);
        const deathPlaceId = ensurePlace(data, f.deathPlace);
        const p = {
          id: currentId,
          name: { given: f.given, surname: f.surname, birthSurname: f.birthSurname || null, suffix: f.suffix || null, display: f.display || null },
          sex: f.sex || null, image: f.image || null, notes: f.notes,
          birth: { date: personDate(f.birthDate), placeId: birthPlaceId },
          death: { date: personDate(f.deathDate), placeId: deathPlaceId }
        };
        data.people[currentId] = p;
        if (created && pendingCreation.value) linkCreatedRelative(data, currentId, pendingCreation.value);
        return currentId;
      }));
      if (result) { pendingCreation.value = null; selectPerson(currentId, true); notify(created ? 'Person created.' : 'Person saved.'); }
    }
    function imageError(event) { event.target.style.display = 'none'; }
    function deletePerson() {
      if (!selectedId.value || !confirm(`Delete ${nameById(selectedId.value)} and all their relationship links? Other people will be kept.`)) { return; }
      const id = selectedId.value;
      const result = commit(() => { store.removePerson(id, { cascade: true }); return true; });
      if (result) { closePanel(); notify('Person deleted.'); }
    }
    function openRelationship(type) {
      relationModal.value = type; editingUnionId.value = null;
      relationship.value = { ...blankRelationship(), type: type === 'union' ? 'marriage' : 'biological' };
    }
    function editUnion(u) {
      relationModal.value = 'union'; editingUnionId.value = u.id;
      relationship.value = { otherId: u.partnerIds.find(id => id !== selectedId.value), type: u.type, start: u.start.date || '', end: u.end?.date || '', endReason: u.end?.reason || 'unknown' };
    }
    function saveRelationship() {
      const r = relationship.value, kind = relationModal.value;
      if (!editingUnionId.value && !r.otherId) { notify('Select a person first.', true); return; }
      const result = commit(() => {
        if (kind === 'union') {
          const u = { partnerIds: [selectedId.value, r.otherId], type: r.type, start: { date: r.start || null, placeId: null }, end: r.end ? { date: r.end, placeId: null, reason: r.endReason } : null };
          if (editingUnionId.value) { store.editUnion(editingUnionId.value, u); }
          else { store.addUnion(u); }
        } else {
          store.addParentChild({ parentId: kind === 'parent' ? r.otherId : selectedId.value, childId: kind === 'parent' ? selectedId.value : r.otherId, type: r.type });
        }
        return true;
      });
      if (result) { relationModal.value = null; notify('Relationship saved.'); }
    }
    function removeLink(l) {
      if (!confirm(`Remove this ${l.type} parent-child relationship?`)) { return; }
      commit(() => { store.removeParentChild(l.parentId, l.childId, l.type); return true; });
    }
    function removeUnion(u) {
      if (!confirm('Remove this marriage/partnership? Parent-child links will remain.')) { return; }
      commit(() => { store.removeUnion(u.id); return true; });
    }
    watch([lineageMode, targetId], highlight);
    watch(cardColors, mode => graph?.setColorBySurname(mode === 'surname'));
    watch([layoutMode, forceAutoEase], ([mode, enabled]) => graph?.setForceAutoEase(mode === 'force' && enabled));
    watch([showSiblingLinks, showMarriageLinks], () => {
      if (layoutMode.value === 'force') updateGraph();
    });
    watch([selectedId, snapshot, pasteOpen, relationModal, bulkOpen], closeContextMenu);
    onMounted(async () => {
      document.addEventListener('pointerdown', dismissContextMenu);
      document.addEventListener('keydown', contextEscape);
      window.addEventListener('resize', closeContextMenu);
      window.addEventListener('scroll', closeContextMenu, true);
      graph = new GraphCanvas(graphCanvas.value, id => selectPerson(id, false), openContextMenu);
      graphRef.value = graph;
      try {
        const draft = await loadDraft();
        modifiedPeople.value = await loadModified() || {};
        const response = await fetch('./data/family.json');
        if (!response.ok) { throw new Error(`Cannot read published data: HTTP ${response.status}`); }
        store = FamilyStore.fromJSON(draft || await response.text());
        snapshot.value = store.snapshot();
        updateGraph(true);
        saveStatus.value = draft ? 'Loaded local draft' : '';
      } catch (err) {
        saveStatus.value = 'Data load error'; saveError.value = true;
        notify(`Could not load family data: ${err.message}. You can create a new family.`, true);
        updateGraph(true);
      }
    });
    onBeforeUnmount(() => {
      clearTimeout(draftTimer); graph?.destroy();
      layoutRequest++;
      clearTimeout(layoutTimer); layoutWorker?.terminate();
      document.removeEventListener('pointerdown', dismissContextMenu);
      document.removeEventListener('keydown', contextEscape);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
    });
    return {
      bulkOpen, bulkElement, bulkFatherId, bulkMotherId, bulkMotherEnabled, bulkRows, bulkText, bulkError, bulkFatherSurname, bulkTwoWordSurname,
      openBulkChildren, closeBulkChildren, addBulkRow, fillBulkRows, saveBulkChildren, bulkKeys,
      contextMenu, contextMenuElement, contextMenuKeys, openContextMenu, saveContextRelationship,
      relationshipExplanation, relationshipDialog, explainContextRelationship,
      createContextRelative, pendingCreation, spouseChildren,
      relativePasteInput, relativePasteText, relativePasteError, fillRelativeForm,
      givenNameInput, personEditorKeys,
      pasteOpen, pastedText, pastedRecord, pasteError, openPaste, reviewPaste, savePaste,
      pastedRelatives, addPasteRelative, removePasteRelative,
      snapshot, modifiedPeople, search, selectedId, selectedPerson, panel, tab, form, relationModal, editingUnionId, relationship,
      lineageMode, targetId, missingHighlights, graph: graphRef, graphCanvas, saveStatus, saveError, message, messageError,
      layoutMode, layoutPending, layoutError, forceAutoEase, showSiblingLinks, showMarriageLinks,
      cardColors, surnameLegendEntries, changeLayout, fitGraph, focusGraph,
      sortedPeople, filteredPeople, parents, children, unions, ancestorCount, descendantCount, personCount, unionCount, linkCount,
      initialsFromForm, initials, fullName, nameById, roleById, imageError, selectPerson, closePanel, createPerson, savePerson, deletePerson,
      openRelationship, editUnion, saveRelationship, removeLink, removeUnion,
      saveJsonFile, undo, redo, history, future
    };
  }
}).mount('#app');
