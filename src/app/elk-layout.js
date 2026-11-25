import { buildLayout } from './graph.js';
import { stressRouter } from './stress-routes.js';

const LAYERED_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.partitioning.activate': 'true',
  'elk.spacing.nodeNode': '68',
  'elk.spacing.componentComponent': '160',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE',
  'elk.layered.considerModelOrder.strategy': 'PREFER_EDGES',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX'
};

const STRESS_OPTIONS = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '360',
  'elk.stress.iterationLimit': '120',
  'elk.randomSeed': '1',
  'elk.spacing.componentComponent': '160'
};

export async function buildElkLayout(data, elk, mode = 'elk') {
  const fallback = buildLayout(data);
  if (!fallback.count) return fallback;

  const stress = mode === 'stress';
  const { nodes, unions, parentConnectors } = fallback;
  const people = new Map();
  const children = [...nodes.values()].sort((a, b) => a.depth - b.depth || a.x - b.x).map(node => {
    const person = { id: `person-${people.size}`, width: node.w, height: node.h, depth: node.depth * 2 };
    people.set(node.id, person);
    return person;
  });
  const edges = [];
  const ports = new Map();
  function port(node, side, group) {
    const key = JSON.stringify([node.id, side, group]);
    if (!ports.has(key)) {
      const id = `port-${ports.size}`;
      const attachment = { id, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
      (node.ports ??= []).push(attachment);
      ports.set(key, id);
    }
    return ports.get(key);
  }
  function connect(source, target, group) {
    const reversed = !stress && source.depth > target.depth;
    const [from, to] = reversed ? [target, source] : [source, target];
    const id = `edge-${edges.length}`;
    const start = stress ? from.id : port(from, 'SOUTH', reversed ? id : group ?? id);
    const end = stress ? to.id : port(to, 'NORTH', reversed ? group ?? id : id);
    edges.push({ id, sources: [start], targets: [end] });
    return { id, reversed, source: from.id, target: to.id };
  }
  const junctions = new Map();
  for (const union of unions) {
    const partners = union.partnerIds.map(id => people.get(id));
    const junction = { id: `union-${junctions.size}`, width: 0, height: 0, depth: Math.max(...partners.map(p => p.depth)) + 1, ordered: true };
    children.push(junction);
    junctions.set(union.id, { junction, branches: partners.map(partner => connect(partner, junction)) });
  }
  const standaloneCounts = new Map();
  for (const { unionId, parentIds, types } of parentConnectors) {
    if (!unionId && !types.every(type => type === 'step')) {
      const id = parentIds[0];
      standaloneCounts.set(id, (standaloneCounts.get(id) || 0) + 1);
    }
  }
  const standalone = new Map();
  const descendants = parentConnectors.map(connector => {
    let source = connector.unionId ? junctions.get(connector.unionId).junction : people.get(connector.parentIds[0]);
    const target = people.get(connector.childId);
    const step = connector.types.every(type => type === 'step');
    if (!connector.unionId && !step && source.depth < target.depth && standaloneCounts.get(connector.parentIds[0]) > 1) {
      if (!standalone.has(source)) {
        const junction = { id: `branch-${standalone.size}`, width: 0, height: 0, depth: source.depth + 1, ordered: true };
        children.push(junction);
        standalone.set(source, { junction, stem: connect(source, junction) });
      }
      const { junction, stem } = standalone.get(source);
      return [connector, [stem, connect(junction, target)]];
    }
    if (!stress && source.depth === target.depth) {
      const bend = { id: `same-row-${edges.length}`, width: 0, height: 0, depth: source.depth + 1 };
      children.push(bend);
      return [connector, [connect(source, bend), connect(target, bend)], true];
    }
    return [connector, [connect(source, target, step ? 'step' : undefined)]];
  });
  let result = await elk.layout({
    id: 'family',
    layoutOptions: stress ? STRESS_OPTIONS : LAYERED_OPTIONS,
    children: children.map(({ depth, ordered, ...node }) => {
      if (stress) return node;
      if (ordered) {
        // ELK numbers ports clockwise, so south-facing siblings read in reverse index order.
        for (const [index, port] of [...node.ports].reverse().entries()) {
          port.layoutOptions['elk.port.index'] = String(index);
        }
      }
      return { ...node, layoutOptions: { 'elk.partitioning.partition': String(depth), 'elk.portConstraints': ordered ? 'FIXED_ORDER' : 'FIXED_SIDE' } };
    }),
    edges
  });
  if (stress) {
    // Stress positions nodes by graph distance. Separate the card rectangles afterwards.
    result = await elk.layout({
      ...result,
      layoutOptions: { 'elk.algorithm': 'sporeOverlap', 'elk.spacing.nodeNode': '24' }
    });
  }

  const positions = new Map(result.children.map(node => [node.id, node]));
  const paths = new Map(result.edges.map(edge => [edge.id, edge.sections]));
  const point = ({ x, y }) => [x, y];
  const routeAroundCards = stress ? stressRouter(positions) : null;
  function route({ id, reversed, source, target }) {
    if (routeAroundCards) return routeAroundCards(positions.get(source), positions.get(target));
    const [section] = paths.get(id) || [];
    if (!section) throw new Error('ELK returned an incomplete relationship route.');
    const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint].map(point);
    return reversed ? points.reverse() : points;
  }
  function join([first, second], reverseSecond = false) {
    const points = route(first);
    if (!second) return points;
    const continuation = route(second);
    if (reverseSecond) continuation.reverse();
    if (points.at(-1).some((value, i) => Math.abs(value - continuation[0][i]) > 1e-6)) {
      throw new Error('ELK returned a disconnected junction.');
    }
    return [...points, ...continuation.slice(1)];
  }
  const cards = new Map([...nodes].map(([id, node]) => {
    const { x, y } = positions.get(people.get(id).id);
    return [id, { ...node, x, y }];
  }));
  const unionRoutes = new Map([...junctions].map(([id, { branches }]) => [id, join(branches, true)]));
  const connections = descendants.map(([connector, branches, reverseSecond]) => {
    const points = join(branches, reverseSecond);
    return { ...connector, route: points, from: points[0], to: points.at(-1) };
  });
  return {
    ...fallback, nodes: cards, unionRoutes, parentConnectors: connections,
    bounds: { minX: 0, minY: 0, maxX: result.width, maxY: result.height }
  };
}
