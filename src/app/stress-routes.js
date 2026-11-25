const CLEARANCE = 5;
const center = node => [node.x + node.width / 2, node.y + node.height / 2];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function crossesBox(a, b, { left, right, top, bottom }) {
  let start = 0, end = 1;
  for (const [axis, min, max] of [[0, left, right], [1, top, bottom]]) {
    const delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] <= min || a[axis] >= max) return false;
      continue;
    }
    const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
  }
  return end - start > 1e-9;
}

function visiblePath(start, end, obstacles) {
  const points = [start, end];
  for (const { left, right, top, bottom } of obstacles) {
    points.push([left, top], [right, top], [left, bottom], [right, bottom]);
  }
  const costs = points.map(() => Infinity), previous = [];
  const open = new Set(points.keys());
  costs[0] = 0;
  while (open.size) {
    let current = 1;
    for (const index of open) if (costs[index] < costs[current]) current = index;
    if (current === 1) {
      if (!Number.isFinite(costs[1])) return [start, end];
      const route = [];
      for (let index = 1; index !== undefined; index = previous[index]) route.push(points[index]);
      return route.reverse();
    }
    open.delete(current);
    for (const index of open) {
      const cost = costs[current] + distance(points[current], points[index]);
      if (cost < costs[index] && !obstacles.some(box => crossesBox(points[current], points[index], box))) {
        costs[index] = cost;
        previous[index] = current;
      }
    }
  }
}

function cardPort(node, point, toward) {
  if (!node.width || !node.height) return point;
  const dx = toward[0] - point[0], dy = toward[1] - point[1];
  const scale = Math.max(2 * Math.abs(dx) / node.width, 2 * Math.abs(dy) / node.height);
  return scale ? [point[0] + dx / scale, point[1] + dy / scale] : point;
}

export function stressRouter(nodes) {
  const cards = [...nodes.values()].filter(node => node.width && node.height).map(node => ({
    node, left: node.x - CLEARANCE, right: node.x + node.width + CLEARANCE,
    top: node.y - CLEARANCE, bottom: node.y + node.height + CLEARANCE
  }));
  return (from, to) => {
    const start = center(from), end = center(to);
    const obstacles = new Set();
    let route = [start, end];
    // Search only the corners of cards that obstruct the route.
    for (let pass = 0; pass < 6; pass++) {
      const blockers = cards.filter(box => box.node !== from && box.node !== to && !obstacles.has(box)
        && route.some((point, i) => i > 0 && crossesBox(route[i - 1], point, box)));
      if (!blockers.length) break;
      for (const box of blockers) obstacles.add(box);
      route = visiblePath(start, end, [...obstacles]);
    }
    route[0] = cardPort(from, start, route[1]);
    route[route.length - 1] = cardPort(to, end, route.at(-2));
    return route;
  };
}
