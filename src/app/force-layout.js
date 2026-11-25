import { buildIndexes } from '../data/indexes.js';

export const FORCE_NODE_RADIUS = 13;
export const FORCE_LINK_STYLES = {
  marriage: { strength: 0.9, distance: 55, color: '#e995b0', width: 3.5, dash: [] },
  partnership: { strength: 0.65, distance: 65, color: '#d6a86e', width: 2.8, dash: [] },
  sibling: { strength: 0.55, distance: 78, color: '#71cbd1', width: 2, dash: [5, 4] },
  biological: { strength: 0.16, distance: 110, color: '#a4b6c7', width: 1.2, dash: [] },
  unknown: { strength: 0.16, distance: 110, color: '#a4b6c7', width: 1.2, dash: [] },
  adoptive: { strength: 0.16, distance: 110, color: '#a6aaff', width: 1.2, dash: [3, 4] },
  step: { strength: 0.16, distance: 110, color: '#e7b46e', width: 1.2, dash: [7, 6] }
};

function buildLinks(data, { showSiblings, showMarriages }) {
  const pairs = new Map();
  function add(a, b, kind) {
    const [source, target] = a < b ? [a, b] : [b, a];
    const key = JSON.stringify([source, target]);
    if (!pairs.has(key)) pairs.set(key, new Map());
    pairs.get(key).set(kind, { source, target, kind });
  }

  if (showMarriages) {
    for (const union of Object.values(data.unions)) {
      add(...union.partnerIds, union.type === 'marriage' ? 'marriage' : 'partnership');
    }
  }
  for (const link of data.parentChild) add(link.parentId, link.childId, link.type);

  if (showSiblings) {
    const { childrenByParent } = buildIndexes(data);
    for (const children of childrenByParent.values()) {
      const siblings = [...new Set(children.filter(link => link.type !== 'step').map(link => link.childId))];
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) add(siblings[i], siblings[j], 'sibling');
      }
    }
  }

  const links = [];
  for (const pair of pairs.values()) {
    let index = 0;
    for (const link of pair.values()) {
      links.push({ ...link, bend: (index++ - (pair.size - 1) / 2) * 18 });
    }
  }
  return links.sort((a, b) => FORCE_LINK_STYLES[a.kind].width - FORCE_LINK_STYLES[b.kind].width);
}

export function buildForceLayout(data, { animate = false, previousNodes, showSiblings = true, showMarriages = true } = {}) {
  const people = Object.keys(data.people).sort().map(id => {
    const previous = previousNodes?.get(id)?.particle;
    return previous ? { id, x: previous.x, y: previous.y } : { id };
  });
  const forceLinks = buildLinks(data, { showSiblings, showMarriages });
  const simulation = d3.forceSimulation(people).stop()
    .alphaMin(0.005)
    .alphaDecay(0.065)
    .force('link', d3.forceLink(forceLinks).id(person => person.id)
      .strength(link => FORCE_LINK_STYLES[link.kind].strength)
      .distance(link => FORCE_LINK_STYLES[link.kind].distance))
    .force('charge', d3.forceManyBody().strength(-190))
    .force('collision', d3.forceCollide(2 * FORCE_NODE_RADIUS).iterations(2))
    .force('x', d3.forceX().strength(0.025))
    .force('y', d3.forceY().strength(0.025));
  const r = FORCE_NODE_RADIUS;
  const nodes = new Map(people.map(particle => [particle.id, {
    id: particle.id, particle, x: 0, y: 0, w: 2 * r, h: 2 * r
  }]));
  const bounds = {};
  function updateGeometry() {
    bounds.minX = bounds.minY = bounds.maxX = bounds.maxY = 0;
    for (const node of nodes.values()) {
      const { x, y } = node.particle;
      node.x = x - r;
      node.y = y - r;
      bounds.minX = Math.min(bounds.minX, node.x);
      bounds.minY = Math.min(bounds.minY, node.y);
      bounds.maxX = Math.max(bounds.maxX, x + r);
      bounds.maxY = Math.max(bounds.maxY, y + r + 20);
    }
  }

  let driftPhase = 0;
  function drift(alpha) {
    driftPhase = (driftPhase + 0.023) % (2 * Math.PI);
    for (const particle of people) {
      const phase = driftPhase + particle.index * 2.4;
      particle.vx += alpha * (0.65 * Math.sin(driftPhase) + 0.55 * Math.sin(phase));
      particle.vy += alpha * (0.65 * Math.cos(driftPhase) + 0.55 * Math.cos(phase));
    }
  }
  function setAutoEase(enabled) {
    simulation.force('drift', enabled ? drift : null);
  }

  const settleTicks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  if (people.length > 1) {
    if (animate && previousNodes?.size) {
      simulation.alpha(0.24);
    } else {
      // Spread nodes enough for the first Fit before showing the rest of the settling.
      simulation.tick(animate ? 24 : settleTicks);
    }
  }
  updateGeometry();
  return { nodes, bounds, count: people.length, forceLinks, simulation, updateGeometry, animate, settleTicks, setAutoEase };
}
