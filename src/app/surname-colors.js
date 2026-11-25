export function surnameColorEntry(person) {
  const recordedName = person.name?.surname?.trim() || person.name?.birthSurname?.trim();
  if (!recordedName) return null;
  const label = recordedName.normalize('NFC').replace(/\s+/g, ' ');
  const key = label.toLowerCase();
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  const color = hash >>> 0;
  return { key, label, color: `hsl(${color % 360} 52% ${23 + ((color >>> 16) % 3) * 4}%)` };
}

export function surnameLegend(people) {
  const entries = new Map();
  for (const person of Object.values(people)) {
    const entry = surnameColorEntry(person);
    if (entry && !entries.has(entry.key)) entries.set(entry.key, entry);
  }
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}
