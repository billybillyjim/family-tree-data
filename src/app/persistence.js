const DB_NAME = 'family-tree-editor-v1';
const STORE = 'drafts';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function operate(mode, callback) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = callback(tx.objectStore(STORE));
      let result;
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Local save was interrupted.'));
    });
  } finally { db.close(); }
}
export const loadDraft = () => operate('readonly', store => store.get('current'));
export const loadModified = () => operate('readonly', store => store.get('person-modified'));
export const saveDraft = (value, modified) => operate('readwrite', store => {
  if (modified) store.put(modified, 'person-modified');
  return store.put(value, 'current');
});
export const clearDraft = () => operate('readwrite', store => store.delete('current'));
export function downloadJson(json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'family.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
