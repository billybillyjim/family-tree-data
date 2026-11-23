function append(map, key, item) {
  if (!map.has(key)) { map.set(key, []); }
  map.get(key).push(item);
}

export function buildIndexes(data) {
  const parentsByChild = new Map();
  const childrenByParent = new Map();
  const unionsByPerson = new Map();
  for (const link of data.parentChild) {
    append(parentsByChild, link.childId, link);
    append(childrenByParent, link.parentId, link);
  }
  for (const union of Object.values(data.unions)) {
    for (const id of union.partnerIds) { append(unionsByPerson, id, union); }
  }
  return { parentsByChild, childrenByParent, unionsByPerson };
}

export function traverseFamily(startId, index, neighborKey, allowedTypes = ['biological', 'adoptive', 'unknown']) {
  const allowed = new Set(allowedTypes);
  const visited = new Set([startId]);
  const results = new Set();
  const queue = [startId];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of index.get(queue[i]) ?? []) {
      if (!allowed.has(edge.type)) { continue; }
      const id = edge[neighborKey];
      if (visited.has(id)) { continue; }
      visited.add(id);
      results.add(id);
      queue.push(id);
    }
  }
  return [...results];
}
