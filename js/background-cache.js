const CACHE_DB_NAME = 'houdini-paint-backgrounds';
const CACHE_DB_VERSION = 1;

function openCacheDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }

    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('backgrounds')) {
        database.createObjectStore('backgrounds', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('benchmarks')) {
        database.createObjectStore('benchmarks', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });
}

function requestDatabase(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
  });
}

class BackgroundCache {
  constructor(database) {
    this.database = database;
  }

  static async create() {
    return new BackgroundCache(await openCacheDatabase());
  }

  async getBackground(key) {
    const transaction = this.database.transaction('backgrounds', 'readonly');
    const record = await requestDatabase(transaction.objectStore('backgrounds').get(key));
    return record?.blob || null;
  }

  async putBackground(key, blob) {
    const transaction = this.database.transaction('backgrounds', 'readwrite');
    await requestDatabase(transaction.objectStore('backgrounds').put({ key, blob, createdAt: Date.now() }));
  }

  async clearBackgrounds() {
    const transaction = this.database.transaction('backgrounds', 'readwrite');
    await requestDatabase(transaction.objectStore('backgrounds').clear());
  }

  async addBenchmark(result) {
    const transaction = this.database.transaction('benchmarks', 'readwrite');
    await requestDatabase(transaction.objectStore('benchmarks').add({ result, createdAt: Date.now() }));
  }

  async getBenchmarks() {
    const transaction = this.database.transaction('benchmarks', 'readonly');
    const records = await requestDatabase(transaction.objectStore('benchmarks').getAll());
    return records.map((record) => record.result);
  }

  async clearBenchmarks() {
    const transaction = this.database.transaction('benchmarks', 'readwrite');
    await requestDatabase(transaction.objectStore('benchmarks').clear());
  }
}
