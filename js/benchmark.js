const BENCHMARK_MODES = ['worklet', 'image', 'canvas'];

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BackgroundBenchmark {
  constructor({ renderer, cache, monitor, onProgress = () => {} }) {
    this.renderer = renderer;
    this.cache = cache;
    this.monitor = monitor;
    this.onProgress = onProgress;
    this.running = false;
  }

  async run({ durationMs = 4000, density = 0.9 } = {}) {
    if (this.running) return [];
    this.running = true;
    const originalOptions = { ...this.renderer.options };
    const originalMode = this.renderer.mode;
    const results = [];

    try {
      for (const mode of BENCHMARK_MODES) {
        if (mode === 'worklet' && !this.renderer.workletReady) {
          results.push({ mode, skipped: true, reason: this.renderer.workletError || 'Worklet 不支持' });
          this.onProgress(`${mode} 跳过：浏览器不支持或加载失败`);
          continue;
        }

        this.onProgress(`正在测试 ${mode}，请等待 ${Math.round(durationMs / 1000)} 秒`);
        const changed = await this.renderer.setMode(mode);
        if (!changed) continue;

        this.renderer.setOptions({ ...originalOptions, density }, { immediate: true });
        await wait(350);
        results.push(await this.measureMode(mode, durationMs, originalOptions));
      }
    } finally {
      this.running = false;
      await this.renderer.setMode(originalMode);
      this.renderer.setOptions(originalOptions, { immediate: true });
    }

    if (this.cache) {
      await this.cache.addBenchmark({ createdAt: Date.now(), results }).catch(() => {});
    }
    return results;
  }

  async measureMode(mode, durationMs, baseOptions) {
    const start = performance.now();
    let frameCount = 0;
    let droppedFrames = 0;
    const frameIntervals = [];
    const drawCosts = [];
    let previousFrameTime = start;

    await new Promise((resolve) => {
      const tick = (now) => {
        const elapsed = now - start;
        if (elapsed >= durationMs) {
          resolve();
          return;
        }

        if (frameCount > 0) {
          const interval = now - previousFrameTime;
          frameIntervals.push(interval);
          if (interval > 24) droppedFrames += 1;
        }
        previousFrameTime = now;

        const nextOptions = {
          ...baseOptions,
          density: 0.9,
          angle: Math.round((baseOptions.angle + elapsed * 0.035) % 360),
          seed: Math.round(baseOptions.seed + frameCount * 7) % 999999
        };

        if (mode === 'canvas') {
          drawCosts.push(this.renderer.drawCanvasWithOptions(nextOptions));
        } else if (mode === 'worklet') {
          const before = performance.now();
          this.renderer.setOptions(nextOptions);
          drawCosts.push(performance.now() - before);
        } else {
          const before = performance.now();
          const offset = Math.round(elapsed * 0.035);
          this.renderer.stage.style.backgroundPosition = `${offset}px ${Math.round(offset * 0.6)}px`;
          drawCosts.push(performance.now() - before);
        }

        frameCount += 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const end = performance.now();
    const longTasks = this.monitor.drainLongTasks(start - 400, end + 100);
    const size = this.renderer.getDevicePixelSize();

    return {
      mode,
      skipped: false,
      durationMs: end - start,
      width: size.width,
      height: size.height,
      fps: frameCount / ((end - start) / 1000),
      frames: frameCount,
      droppedFrames,
      avgFrameMs: average(frameIntervals),
      p95FrameMs: percentile(frameIntervals, 95),
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((total, task) => total + task.duration, 0),
      avgDrawMs: average(drawCosts),
      note: mode === 'image'
        ? '静态图不逐帧栅格化；通过 background-position 验证合成位移成本'
        : mode === 'worklet'
          ? 'CSS 变量逐帧更新，Worklet 响应式重绘'
          : 'Canvas 2D 在主线程逐帧完整重绘'
    };
  }
}
