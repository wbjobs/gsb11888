class PerfMonitor {
  constructor() {
    this.entries = [];
    this.supported = typeof PerformanceObserver !== 'undefined';
    if (this.supported) {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (this.entries.length < 500) this.entries.push(entry);
        }
      });
      try {
        this.observer.observe({ entryTypes: ['longtask', 'measure'] });
      } catch {
        try {
          this.observer.observe({ entryTypes: ['measure'] });
        } catch {
          this.supported = false;
        }
      }
    }
  }

  mark(name) {
    performance.mark(name);
  }

  measure(name, startMark, endMark) {
    try {
      performance.measure(name, startMark, endMark);
    } catch {
      // Marks can be missing if initialization was interrupted.
    }
  }

  drainLongTasks(startTime, endTime) {
    if (!this.supported) return [];
    const records = this.entries
      .filter((entry) => entry.entryType === 'longtask' && entry.startTime >= startTime && entry.startTime <= endTime)
      .map((entry) => ({ startTime: entry.startTime, duration: entry.duration }));
    this.entries = this.entries.filter((entry) => entry.entryType !== 'longtask' || !records.includes(entry));
    return records;
  }

  getMeasures(prefix) {
    return this.entries
      .filter((entry) => entry.entryType === 'measure' && entry.name.startsWith(prefix))
      .map((entry) => entry.duration);
  }

  disconnect() {
    if (this.observer) this.observer.disconnect();
  }
}
