import { buildLayout } from './graph.js';
import { stressRouter } from './stress-routes.js';

const YEAR_SPACING = 16;
const CARD_GAP = 56;

export function buildTimelineLayout(data) {
  const original = buildLayout(data);
  if (!original.count) return original;

  let firstYear = Infinity, lastYear = -Infinity;
  const cards = [...original.nodes.values()].map(node => {
    const date = data.people[node.id].birth?.date;
    const year = date ? Number(date.slice(0, 4)) : null;
    if (year !== null) {
      firstYear = Math.min(firstYear, year);
      lastYear = Math.max(lastYear, year);
    }
    return { ...node, year };
  });
  const originY = cards[0].h / 2 + 30;
  const hasDates = firstYear !== Infinity;
  const lastY = hasDates ? originY + (lastYear - firstYear) * YEAR_SPACING : originY;
  const unknownY = hasDates ? lastY + cards[0].h + 60 : originY;
  for (const card of cards) {
    const centerY = card.year === null ? unknownY : originY + (card.year - firstYear) * YEAR_SPACING;
    card.y = centerY - card.h / 2;
  }

  // Keep the previous branch order as a starting point. Move cards horizontally
  // when their date positions would otherwise put them on top of one another.
  const laneWidth = cards[0].w + CARD_GAP, laneEnds = new Map();
  cards.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const card of cards) {
    const preferred = Math.round(card.x / laneWidth);
    const available = lane => lane >= 0 && (laneEnds.get(lane) ?? -Infinity) <= card.y;
    let lane = preferred;
    for (let distance = 1; !available(lane); distance++) {
      lane = available(preferred - distance) ? preferred - distance : preferred + distance;
    }
    card.x = lane * laneWidth;
    laneEnds.set(lane, card.y + card.h + 12);
  }

  const nodes = new Map(cards.map(card => [card.id, card]));
  const shapes = new Map(cards.map(({ id, x, y, w, h }) => [id, { x, y, width: w, height: h }]));
  const route = stressRouter(shapes);
  const junctions = new Map(), unionRoutes = new Map();
  for (const union of original.unions) {
    const [a, b] = union.partnerIds.map(id => shapes.get(id));
    const y = (a.y + a.height / 2 + b.y + b.height / 2) / 2;
    let x = (a.x + a.width / 2 + b.x + b.width / 2) / 2;
    const blocked = cards.filter(card => y >= card.y - 12 && y <= card.y + card.h + 12)
      .map(card => [card.x - 12, card.x + card.w + 12]);
    for (const point of junctions.values()) {
      if (Math.abs(point.y - y) < 16) blocked.push([point.x - 16, point.x + 16]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    for (const [left, right] of blocked) {
      if (x > left && x < right) x = right;
    }
    const junction = { x, y, width: 0, height: 0 };
    junctions.set(union.id, junction);
    unionRoutes.set(union.id, [...route(a, junction), ...route(junction, b).slice(1)]);
  }
  const parentConnectors = original.parentConnectors.map(connector => {
    const source = junctions.get(connector.unionId) || shapes.get(connector.parentIds[0]);
    const points = route(source, shapes.get(connector.childId));
    return { ...connector, route: points, from: points[0], to: points.at(-1) };
  });

  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  function include(x, y) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  for (const card of cards) include(card.x + card.w, card.y + card.h);
  for (const points of unionRoutes.values()) for (const point of points) include(...point);
  for (const connector of parentConnectors) for (const point of connector.route) include(...point);
  const timeline = {
    firstYear: hasDates ? firstYear : null, lastYear: hasDates ? lastYear : null,
    originY, yearSpacing: YEAR_SPACING,
    unknownY: cards.some(card => card.year === null) ? unknownY : null
  };
  return { ...original, nodes, bounds, unionRoutes, parentConnectors, timeline };
}
