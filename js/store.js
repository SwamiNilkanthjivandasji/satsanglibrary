// બ્રાઉઝરમાં સેવ (IndexedDB). આના લીધે એકવાર લોડ થયેલી બુક ઓફલાઇન પણ ખૂલે.
// IndexedDB ઉપલબ્ધ ન હોય કે quota ભરાઈ જાય તો એપ તૂટતી નથી; ફક્ત ઓફલાઇન સેવ થતું નથી.
import { CONFIG } from './config.js';

const { dbName, storeName, version } = CONFIG.storage;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) return reject(new Error('indexedDB unavailable'));
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {});
  }
  return dbPromise;
}

function request(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function get(key) {
  try {
    return await request('readonly', (s) => s.get(key));
  } catch (_) {
    return undefined;
  }
}

// સફળ થાય તો true, નિષ્ફળ (quota વગેરે) તો false
export async function set(key, value) {
  try {
    await request('readwrite', (s) => s.put(value, key));
    return true;
  } catch (_) {
    return false;
  }
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (_) {
    /* અવગણો */
  }
}
