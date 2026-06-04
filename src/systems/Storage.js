// IndexedDB persistence for multiple worlds. Each world is one record keyed by
// its id; a separate index record lists world metadata for the menu. Terrain is
// regenerated from each world's seed, so records only hold edits + entity state.

const DB_NAME = 'apexcraft';
const STORE = 'worlds';
const INDEX = '__index__';
const VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const rq = store.get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  try {
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let out;
      Promise.resolve(fn(store)).then((v) => { out = v; }).catch(reject);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export async function listWorlds() {
  try {
    return (await withStore('readonly', (s) => idbGet(s, INDEX))) || [];
  } catch (e) {
    console.warn('listWorlds failed:', e);
    return [];
  }
}

export async function loadWorld(id) {
  try {
    return (await withStore('readonly', (s) => idbGet(s, id))) || null;
  } catch (e) {
    console.warn('loadWorld failed:', e);
    return null;
  }
}

export async function saveWorld(id, data) {
  try {
    await withStore('readwrite', async (s) => {
      s.put(data, id);
      const index = (await idbGet(s, INDEX)) || [];
      const meta = { id, name: data.name, seed: data.seed, lastPlayed: data.lastPlayed || 0 };
      const i = index.findIndex((w) => w.id === id);
      if (i >= 0) index[i] = meta; else index.push(meta);
      s.put(index, INDEX);
    });
    return true;
  } catch (e) {
    console.warn('saveWorld failed:', e);
    return false;
  }
}

export async function deleteWorld(id) {
  try {
    await withStore('readwrite', async (s) => {
      s.delete(id);
      const index = (await idbGet(s, INDEX)) || [];
      s.put(index.filter((w) => w.id !== id), INDEX);
    });
    return true;
  } catch (e) {
    console.warn('deleteWorld failed:', e);
    return false;
  }
}
