class WorkerRasterizer {
  constructor(url = 'workers/background-worker.js') {
    this.worker = new Worker(url);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.worker.onmessage = (event) => {
      const resolver = this.pending.get(event.data.id);
      if (!resolver) return;
      this.pending.delete(event.data.id);
      if (event.data.error) {
        resolver.reject(new Error(event.data.error));
      } else {
        resolver.resolve(event.data.blob);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker 加载或执行失败');
      for (const resolver of this.pending.values()) resolver.reject(error);
      this.pending.clear();
    };
  }

  rasterize({ width, height, devicePixelRatio, options }) {
    const id = this.nextRequestId++;
    const message = { id, width, height, devicePixelRatio, options };
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Worker 栅格化超时'));
      }, 15000);

      this.pending.set(id, {
        resolve: (blob) => {
          clearTimeout(timeoutId);
          resolve(blob);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      this.worker.postMessage(message);
    });
  }

  terminate() {
    this.worker.terminate();
    this.pending.clear();
  }
}
