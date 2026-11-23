import { arrangeFamilies, birthOrder, unionOrder } from './family-layout.js';
import { routeFamilies } from './family-routes.js';

const COMPONENT_GAP = 240;

export function personName(p) {
  return p.name.display?.trim() || [p.name.given, p.name.surname, p.name.suffix].filter(Boolean).join(' ').trim() || 'Unnamed';
}

function connectedComponents(ids, links, unions) {
  const neighbors = new Map(ids.map(id => [id, []]));
  function connect(a, b) {
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  for (const link of links) connect(link.parentId, link.childId);
  for (const union of unions) connect(...union.partnerIds);

  const components = [], componentByPerson = new Map();
  for (const id of ids) {
    if (componentByPerson.has(id)) continue;
    const component = { ids: [id], links: [], unions: [] };
    components.push(component);
    componentByPerson.set(id, component);
    for (let i = 0; i < component.ids.length; i++) {
      for (const other of neighbors.get(component.ids[i])) {
        if (componentByPerson.has(other)) continue;
        componentByPerson.set(other, component);
        component.ids.push(other);
      }
    }
  }
  for (const link of links) componentByPerson.get(link.childId).links.push(link);
  for (const union of unions) componentByPerson.get(union.partnerIds[0]).unions.push(union);
  return components.sort((a, b) => b.ids.length - a.ids.length);
}

export function buildLayout(data) {
  const { people, parentChild: parentLinks } = data;
  const ids = Object.keys(people).sort((a, b) => birthOrder(people[a], people[b]));
  const unions = Object.values(data.unions).sort(unionOrder);
  const nodes = new Map(), unionRoutes = new Map(), parentConnectors = [];
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let offset = 0;
  for (const component of connectedComponents(ids, parentLinks, unions)) {
    const layout = arrangeFamilies(component.ids, component.links, component.unions, people);
    const routes = routeFamilies(layout, component.unions);
    const moved = new Set();
    function translateRoute(route) {
      for (const point of route) {
        // Sibling connectors share their stem points.
        if (moved.has(point)) continue;
        moved.add(point);
        point[0] += offset;
        bounds.maxX = Math.max(bounds.maxX, point[0]);
        bounds.maxY = Math.max(bounds.maxY, point[1]);
      }
    }
    for (const node of layout.nodes.values()) {
      node.x += offset;
      bounds.maxX = Math.max(bounds.maxX, node.x + node.w);
      bounds.maxY = Math.max(bounds.maxY, node.y + node.h);
      nodes.set(node.id, node);
    }
    for (const [id, route] of routes.unionRoutes) {
      translateRoute(route);
      unionRoutes.set(id, route);
    }
    for (const connector of routes.parentConnectors) {
      translateRoute(connector.route);
      parentConnectors.push(connector);
    }
    offset = bounds.maxX + COMPONENT_GAP;
  }
  return { nodes, bounds, parentLinks, parentConnectors, unions, unionRoutes, count: ids.length };
}

export function getMissingDataHighlights(data, mode) {
  if (mode === 'missing-dates') {
    return new Set(Object.values(data.people).filter(person => !person.birth.date || !person.death.date).map(person => person.id));
  }
  if (mode !== 'missing-parents') return null;

  const missing = new Set(Object.keys(data.people));
  const firstParent = new Map();
  for (const { childId, parentId, type } of data.parentChild) {
    if (type === 'step' || !missing.has(childId)) continue;
    if (!firstParent.has(childId)) firstParent.set(childId, parentId);
    else if (firstParent.get(childId) !== parentId) missing.delete(childId);
  }
  return missing;
}

export function getLineage(store, id, mode, types = ['biological', 'adoptive', 'unknown'], target = null) {
  if (!id) { return new Set(); }
  const result = new Set([id]);
  if (mode === 'ancestors' || mode === 'both') {
    for (const ancestor of store.getAncestors(id, types)) { result.add(ancestor); }
  }
  if (mode === 'descendants' || mode === 'both') {
    for (const descendant of store.getDescendants(id, types)) { result.add(descendant); }
  }
  if (mode === 'path' && target && target !== id) {
    // Undirected relationship route, including unions and all parent types.
    const data = store.snapshot();
    const adj = new Map(Object.keys(data.people).map(k => [k, []]));
    for (const e of data.parentChild) {
      if (!types.includes(e.type)) { continue; }
      adj.get(e.parentId).push(e.childId);
      adj.get(e.childId).push(e.parentId);
    }
    for (const union of Object.values(data.unions)) {
      const [a, b] = union.partnerIds;
      adj.get(a).push(b); adj.get(b).push(a);
    }
    const previous = new Map([[id, null]]);
    const queue = [id];
    for (let i = 0; i < queue.length && !previous.has(target); i++) {
      for (const next of adj.get(queue[i])) {
        if (!previous.has(next)) { previous.set(next, queue[i]); queue.push(next); }
      }
    }
    if (!previous.has(target)) { return new Set([id]); }
    let current = target;
    while (current !== null) { result.add(current); current = previous.get(current); }
  }
  return result;
}
