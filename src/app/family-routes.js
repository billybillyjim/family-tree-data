const MIN_ROW_GAP = 124;
const LANE_SPACING = 16;
const PORT_MARGIN = 20;
const GUTTER_STEP = 24;
const ROUTE_CLEARANCE = 12;

const center = node => node.x + node.w / 2;
const bottom = node => node.y + node.h;

function track(gap, from, to, kind, upper, lower = []) {
  const lane = { left: Math.min(from, to), right: Math.max(from, to), upper, lower };
  gap[kind].push(lane);
  return lane;
}

function assignTracks(tracks, startY) {
  const events = [];
  for (const lane of tracks) {
    events.push({ x: lane.left - 8, lane, enter: true }, { x: lane.right + 8, lane, enter: false });
  }
  events.sort((a, b) => a.x - b.x || Number(b.enter) - Number(a.enter));
  let count = 0;
  const free = [], active = new Set(), costs = [];
  // An upper port crosses any horizontal track lying above its own track.
  // A lower port has the opposite constraint.
  function crossingCost(above, below) {
    if (Math.max(above.left, below.left) >= Math.min(above.right, below.right)) return 0;
    const inside = (x, lane) => lane.left < x && x < lane.right;
    return above.lower.filter(x => inside(x, below)).length + below.upper.filter(x => inside(x, above)).length;
  }
  function addCost(above, below) {
    const cost = crossingCost(above, below);
    if (cost) {
      const row = costs[above.index];
      row.set(below.index, (row.get(below.index) || 0) + cost);
    }
  }
  for (const { lane, enter } of events) {
    if (enter) {
      lane.index = free.length ? free.pop() : count++;
      costs[lane.index] ??= new Map();
      for (const other of active) {
        addCost(lane, other);
        addCost(other, lane);
      }
      active.add(lane);
    } else {
      active.delete(lane);
      free.push(lane.index);
    }
  }
  // Reorder the occupied lanes without changing which intervals share a lane.
  const order = Array.from({ length: count }, (_, i) => i);
  for (let sweep = 0; sweep < 4; sweep++) {
    let changed = false;
    for (let i = 1; i < order.length; i++) {
      const index = sweep % 2 ? order.length - i - 1 : i - 1;
      const above = order[index], below = order[index + 1];
      if ((costs[above].get(below) || 0) <= (costs[below].get(above) || 0)) continue;
      order[index] = below;
      order[index + 1] = above;
      changed = true;
    }
    if (!changed) break;
  }
  const positions = [];
  order.forEach((lane, i) => { positions[lane] = i; });
  for (const lane of tracks) lane.y = startY + positions[lane.index] * LANE_SPACING;
  return count * LANE_SPACING;
}

function corridorFinder(rows, depths, width) {
  const depthIndex = new Map(depths.map((depth, i) => [depth, i]));
  let right = width;
  const corridors = [];
  return (fromDepth, toDepth, preferredX) => {
    const low = Math.min(fromDepth, toDepth), high = Math.max(fromDepth, toDepth);
    const obstacles = [];
    const firstRow = (depthIndex.get(low) ?? -1) + 1, lastRow = depthIndex.get(high);
    for (let i = firstRow; i <= lastRow; i++) {
      for (const node of rows.get(depths[i])) obstacles.push([node.x - ROUTE_CLEARANCE, node.x + node.w + ROUTE_CLEARANCE]);
    }
    for (const { low: start, high: end, x } of corridors) {
      if (start <= high && end >= low) obstacles.push([x - ROUTE_CLEARANCE, x + ROUTE_CLEARANCE]);
    }
    obstacles.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, end] of obstacles) {
      const previous = merged.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    const blocked = merged.find(([start, end]) => start < preferredX && preferredX < end);
    let x = preferredX;
    if (blocked) {
      const [left, right] = blocked;
      x = left >= 0 && preferredX - left <= right - preferredX ? left : right;
    }
    if (x > width) x = right += GUTTER_STEP;
    corridors.push({ low, high, x });
    return x;
  };
}

function partnershipPlans(unions, nodes, slots, gaps, findCorridor) {
  const plans = [], seenPairs = new Set();
  const ports = new Map();
  for (const union of unions) {
    const [a, b] = union.partnerIds.map(id => nodes.get(id)).sort((a, b) => a.x - b.x);
    const pair = JSON.stringify([a.id, b.id]);
    const direct = a.depth === b.depth && slots.get(b.id) - slots.get(a.id) === 1 && !seenPairs.has(pair);
    seenPairs.add(pair);
    const plan = { union, a, b, direct };
    plans.push(plan);
    if (direct) continue;
    for (const [side, node, partner] of [['aX', a, b], ['bX', b, a]]) {
      if (!ports.has(node)) ports.set(node, []);
      ports.get(node).push({ plan, side, partner });
    }
  }

  // Separate departure ports where a person has several marriages. Leave
  // the center of the card free for a standalone parent-child connector.
  for (const [node, entries] of ports) {
    entries.sort((a, b) => a.partner.x - b.partner.x);
    const left = entries.filter(entry => entry.partner.x < node.x);
    // Attach longer spans closer to the center so shorter routes fit inside them.
    const right = entries.filter(entry => entry.partner.x >= node.x).sort((a, b) => b.partner.x - a.partner.x);
    for (const [side, portList] of [[-1, left], [1, right]]) {
      portList.forEach(({ plan, side: property }, i) => {
        const share = (i + 1) / (portList.length + 1);
        plan[property] = center(node) + side * (PORT_MARGIN + share * (node.w / 2 - 2 * PORT_MARGIN));
      });
    }
  }

  const sources = new Map();
  for (const plan of plans) {
    const { union, a, b, aX, bX, direct } = plan;
    let source;
    if (direct) {
      source = { x: (a.x + a.w + b.x) / 2, depth: a.depth, y: () => a.y + a.h / 2 };
    } else if (a.depth === b.depth) {
      plan.aTrack = plan.bTrack = track(gaps.get(a.depth), aX, bX, 'marriages', [aX, bX]);
      // Even repeat marriages between the same partners have separate junctions.
      const x = (center(a) + center(b)) / 2 + (aX - center(a)) / 4;
      source = { x, depth: a.depth, y: () => plan.aTrack.y };
    } else {
      plan.corridor = findCorridor(a.depth, b.depth, (aX + bX) / 2);
      const lowerIsA = a.depth > b.depth;
      const upper = lowerIsA ? b : a, lower = lowerIsA ? a : b;
      const upperPort = lowerIsA ? bX : aX, lowerPort = lowerIsA ? aX : bX;
      const upperTrack = track(gaps.get(upper.depth), upperPort, plan.corridor, 'marriages', [upperPort], [plan.corridor]);
      const lowerTrack = track(gaps.get(lower.depth), lowerPort, plan.corridor, 'marriages', [lowerPort, plan.corridor]);
      plan.aTrack = lowerIsA ? lowerTrack : upperTrack;
      plan.bTrack = lowerIsA ? upperTrack : lowerTrack;
      const offset = Math.max(-PORT_MARGIN, Math.min(PORT_MARGIN, (plan.corridor - lowerPort) / 2));
      source = {
        x: lowerPort + offset,
        depth: Math.max(a.depth, b.depth),
        y: () => (lowerIsA ? plan.aTrack : plan.bTrack).y
      };
    }
    sources.set(union.id, source);
  }
  return { plans, sources };
}

function parentPlans(families, nodes, sources, previousRow, gaps, findCorridor) {
  const groups = [], intoChild = new Map();
  const standalone = new Map(), sourcePorts = new Map();
  for (const family of families) {
    if (family.links[0].unionId) continue;
    const parent = nodes.get(family.sourceIds[0]);
    if (!standalone.has(parent)) standalone.set(parent, []);
    standalone.get(parent).push(family);
  }
  // Give separate ancestry and step branches their own exit at the bottom of a card.
  for (const [parent, branches] of standalone) {
    branches.forEach((family, i) => {
      const x = center(parent) + PORT_MARGIN * (2 * (i + 1) / (branches.length + 1) - 1);
      sourcePorts.set(family, { x, depth: parent.depth, y: () => bottom(parent) });
    });
  }
  for (const family of families) {
    const unionId = family.links[0].unionId;
    const source = unionId ? sources.get(unionId) : sourcePorts.get(family);
    const byDepth = new Map();
    for (const link of family.links) {
      const child = nodes.get(link.childId);
      if (!byDepth.has(child.depth)) {
        const group = { source, depth: child.depth, children: [] };
        byDepth.set(child.depth, group);
        groups.push(group);
      }
      const entry = { child, link, source };
      byDepth.get(child.depth).children.push(entry);
      if (!intoChild.has(child)) intoChild.set(child, []);
      intoChild.get(child).push(entry);
    }
  }
  for (const [node, entries] of intoChild) {
    entries.sort((a, b) => a.source.x - b.source.x);
    entries.forEach((entry, i) => {
      entry.x = node.x + PORT_MARGIN + (node.w - 2 * PORT_MARGIN) * (i + 1) / (entries.length + 1);
    });
  }
  for (const group of groups) {
    const { source, depth, children } = group;
    const approach = previousRow.get(depth);
    let left = Infinity, right = -Infinity;
    for (const { x } of children) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    // A link skipping rows or running upward uses a nearby clear column
    // through the intervening rows.
    let anchor = source.x;
    const goesUp = approach < source.depth;
    if (approach !== source.depth) {
      group.corridor = anchor = findCorridor(source.depth, approach, (2 * source.x + left + right) / 4);
      group.departure = track(gaps.get(source.depth), source.x, anchor, 'children',
        goesUp ? [source.x, anchor] : [source.x], goesUp ? [] : [anchor]);
    }
    const drops = children.map(({ x }) => x);
    if (goesUp) drops.push(anchor);
    group.arrival = track(gaps.get(approach), Math.min(anchor, left), Math.max(anchor, right), 'children',
      goesUp ? [] : [anchor], drops);
  }
  return groups;
}

export function routeFamilies(layout, unions) {
  const { rows, nodes, width, families } = layout;
  const depths = [...rows.keys()].sort((a, b) => a - b);
  const gaps = new Map([[-1, { marriages: [], children: [] }]]);
  const previousRow = new Map(), slots = new Map();
  let previous = -1;
  for (const depth of depths) {
    const row = rows.get(depth);
    row.forEach((node, index) => slots.set(node.id, index));
    gaps.set(depth, { marriages: [], children: [] });
    previousRow.set(depth, previous);
    previous = depth;
  }

  const findCorridor = corridorFinder(rows, depths, width);
  const { plans, sources } = partnershipPlans(unions, nodes, slots, gaps, findCorridor);
  const groups = parentPlans(families, nodes, sources, previousRow, gaps, findCorridor);

  const top = gaps.get(-1);
  let nextY = top.children.length ? assignTracks(top.children, LANE_SPACING) + LANE_SPACING : 0;
  for (const depth of depths) {
    const row = rows.get(depth);
    for (const node of row) node.y = nextY;
    const gap = gaps.get(depth), startY = bottom(row[0]) + LANE_SPACING;
    const marriageHeight = assignTracks(gap.marriages, startY);
    const childHeight = assignTracks(gap.children, startY + marriageHeight);
    const required = marriageHeight + childHeight + 2 * LANE_SPACING;
    const extra = Math.max(0, MIN_ROW_GAP - required);
    for (const lane of gap.children) lane.y += extra / 2;
    nextY = bottom(row[0]) + required + extra;
  }

  const unionRoutes = new Map();
  for (const { union, a, b, direct, aX, bX, aTrack, bTrack, corridor } of plans) {
    const points = direct
      ? [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]]
      : [[aX, bottom(a)], [aX, aTrack.y], ...(corridor === undefined ? [] : [[corridor, aTrack.y], [corridor, bTrack.y]]), [bX, bTrack.y], [bX, bottom(b)]];
    unionRoutes.set(union.id, points);
  }

  const parentConnectors = [];
  for (const { source, children, departure, arrival, corridor } of groups) {
    const from = [source.x, source.y()];
    const stem = departure
      ? [from, [source.x, departure.y], [corridor, departure.y], [corridor, arrival.y]]
      : [from, [source.x, arrival.y]];
    for (const { child, link, x } of children) {
      const to = [x, child.y];
      parentConnectors.push({ ...link, from, to, route: [...stem, [x, arrival.y], to] });
    }
  }
  return { unionRoutes, parentConnectors };
}
