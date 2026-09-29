const VAR_NAMES = {
  pattern: '--bg-pattern',
  color1: '--bg-color-1',
  color2: '--bg-color-2',
  density: '--bg-density',
  angle: '--bg-angle',
  opacity: '--bg-opacity',
  seed: '--bg-seed',
  stripeWidth: '--bg-stripe-width',
  particleSize: '--bg-particle-size'
};

function createCssFallbackStyle(options) {
  const angle = `${Math.round(options.angle)}deg`;
  const base = `linear-gradient(${angle}, ${options.color1}, ${options.color2})`;
  const stripe = `repeating-linear-gradient(${angle}, rgba(255,255,255,0.22) 0 ${Math.round(options.stripeWidth / 2)}px, transparent ${Math.round(options.stripeWidth / 2)}px ${Math.round(options.stripeWidth)}px)`;
  const noise = 'radial-gradient(circle at 25% 30%, rgba(255,255,255,.35) 0 1px, transparent 1.6px), radial-gradient(circle at 70% 60%, rgba(0,0,0,.18) 0 1px, transparent 1.8px)';
  const particles = 'radial-gradient(circle at 18% 28%, rgba(255,255,255,.65) 0 2px, transparent 2.8px), radial-gradient(circle at 72% 34%, rgba(255,255,255,.42) 0 1.5px, transparent 2.2px), radial-gradient(circle at 48% 74%, rgba(255,255,255,.52) 0 1.8px, transparent 2.5px)';
  const layer = options.pattern === 'stripes' ? stripe : options.pattern === 'noise' ? noise : options.pattern === 'particles' ? particles : null;
  return layer ? `${layer}, ${base}` : base;
}

class BackgroundRenderer {
  constructor({ stage, canvas, cache, rasterizer, onStatusChange = () => {} }) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
    this.cache = cache;
    this.rasterizer = rasterizer;
    this.onStatusChange = onStatusChange;
    this.mode = 'worklet';
    this.options = HoudiniPaintCore.createDefaultOptions();
    this.warnings = [];
    this.workletReady = false;
    this.workletError = '';
    this.currentImageUrl = '';
    this.imageGeneration = 0;
    this.lastImageResult = null;
    this.drawBudgetMs = 12;
    this.resizeThrottler = createRafThrottle(() => this.handleResize());
    if ('ResizeObserver' in globalThis) {
      this.resizeObserver = new ResizeObserver(this.resizeThrottler);
      this.resizeObserver.observe(stage);
    } else {
      globalThis.addEventListener('resize', this.resizeThrottler);
      this.resizeObserver = null;
    }
    this.scheduleFrameUpdate = createRafThrottle(() => this.commitFrameUpdate());
    this.scheduleImage = createDebounce(() => this.renderImage(), 180);
  }

  isWorkletSupported() {
    return 'paintWorklet' in CSS;
  }

  async loadWorklet(url = 'worklet/background-paint.js') {
    if (!('paintWorklet' in CSS)) {
      this.workletError = '当前浏览器不支持 CSS Houdini Paint Worklet';
      await this.fallbackFromWorklet('unsupported');
      return false;
    }

    try {
      const urlObject = new URL(url, location.href);
      if (urlObject.origin !== location.origin) {
        throw new Error('Paint Worklet 必须同源加载，跨域脚本已拒绝');
      }

      let timer = 0;
      await Promise.race([
        CSS.paintWorklet.addModule(urlObject.href),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Paint Worklet 加载超时')), 8000);
        })
      ]);
      clearTimeout(timer);
      this.workletReady = true;
      this.workletError = '';
      this.emitStatus('Worklet 已注册，CSS 变量变化会触发重绘');
      await this.setMode(this.mode === 'image' || this.mode === 'canvas' ? this.mode : 'worklet');
      return true;
    } catch (error) {
      this.workletError = error?.message || String(error);
      await this.fallbackFromWorklet('load-error');
      return false;
    }
  }

  async fallbackFromWorklet(reason) {
    this.workletReady = false;
    if (this.mode === 'worklet') {
      if (!this.ctx) {
        this.applyCssFallback('Canvas 不可用');
      } else {
        await this.setMode(this.rasterizer ? 'image' : 'canvas');
      }
    }
    this.emitStatus(`Worklet 不可用（${reason}）：${this.workletError}；已切换到一致的静态背景降级方案`);
  }

  emitStatus(message, warnings = this.warnings) {
    this.onStatusChange({ message, warnings, mode: this.mode, workletReady: this.workletReady });
  }

  syncCssVariables(rawOptions = this.options) {
    const { options, warnings } = HoudiniPaintCore.parsePaintOptions(rawOptions);
    this.options = options;
    this.warnings = warnings;
    const root = this.stage;
    root.style.setProperty(VAR_NAMES.pattern, options.pattern);
    root.style.setProperty(VAR_NAMES.color1, options.color1);
    root.style.setProperty(VAR_NAMES.color2, options.color2);
    root.style.setProperty(VAR_NAMES.density, String(options.density));
    root.style.setProperty(VAR_NAMES.angle, String(options.angle));
    root.style.setProperty(VAR_NAMES.opacity, String(options.opacity));
    root.style.setProperty(VAR_NAMES.seed, String(options.seed));
    root.style.setProperty(VAR_NAMES.stripeWidth, String(options.stripeWidth));
    root.style.setProperty(VAR_NAMES.particleSize, String(options.particleSize));
    return { options, warnings };
  }

  setOptions(rawOptions, { immediate = false } = {}) {
    const { options, warnings } = HoudiniPaintCore.parsePaintOptions(rawOptions);
    this.options = options;
    this.warnings = warnings;

    if (immediate) {
      this.scheduleFrameUpdate.cancel();
      this.syncCssVariables(this.options);
    }

    if (immediate && this.mode === 'canvas') {
      this.drawCanvasNow();
    } else if (this.mode === 'canvas' || this.mode === 'worklet') {
      this.scheduleFrameUpdate();
    } else if (this.mode === 'image') {
      if (immediate) this.renderImage();
      else this.scheduleImage();
    } else if (this.mode === 'fallback') {
      this.stage.style.backgroundImage = createCssFallbackStyle(this.options);
    }

    this.emitStatus(this.currentStatusMessage || this.getModeDescription(), warnings);
    return { options, warnings };
  }

  getModeDescription() {
    return {
      worklet: 'Paint Worklet：绘制运行在 Worklet，CSS 变量驱动重绘',
      image: '普通背景图：Worker 栅格化 PNG，IndexedDB 命中缓存',
      canvas: 'Canvas 覆盖层：主线程即时 Canvas 2D 重绘',
      fallback: '纯 CSS 静态背景：最终降级，视觉结构保持一致'
    }[this.mode];
  }

  async setMode(mode) {
    this.scheduleFrameUpdate.cancel();
    this.scheduleImage.cancel();
    if (mode === 'worklet' && !this.workletReady) {
      this.emitStatus(`无法切换到 Worklet：${this.workletError || '尚未加载'}`);
      return false;
    }

    this.syncCssVariables(this.options);
    this.mode = mode;
    if (mode === 'canvas' && !this.ctx) {
      this.applyCssFallback('Canvas 2D 不可用');
      return false;
    }
    this.stage.classList.remove('mode-worklet', 'mode-image', 'mode-canvas', 'mode-fallback');
    this.stage.classList.add(`mode-${mode}`);
    this.canvas.hidden = mode !== 'canvas';

    if (this.currentImageUrl) {
      this.stage.style.backgroundImage = '';
      URL.revokeObjectURL(this.currentImageUrl);
      this.currentImageUrl = '';
    }
    this.stage.style.backgroundPosition = '';

    if (mode === 'fallback') {
      this.applyCssFallback('手动选择或恢复最终降级模式');
    } else if (mode === 'worklet') {
      this.stage.style.backgroundImage = 'paint(custom-background)';
      this.emitStatus('Worklet：尺寸或 CSS 变量变化会自动重绘');
    } else if (mode === 'canvas') {
      this.resizeCanvas();
      this.drawCanvasNow();
      this.emitStatus('Canvas 覆盖层：rAF 合并高频参数变化');
    } else if (mode === 'image') {
      await this.renderImage();
    }

    return true;
  }

  getCssPixelSize() {
    const rect = this.stage.getBoundingClientRect();
    return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  getDevicePixelSize() {
    const { width, height } = this.getCssPixelSize();
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    return {
      cssWidth: width,
      cssHeight: height,
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
      ratio
    };
  }

  resizeCanvas() {
    const size = this.getDevicePixelSize();
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.canvas.style.width = `${size.cssWidth}px`;
    this.canvas.style.height = `${size.cssHeight}px`;
    this.ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    return size;
  }

  scheduleCanvasDraw() {
    if (!this.canvasFrame) {
      this.canvasFrame = requestAnimationFrame(() => {
        this.canvasFrame = 0;
        this.drawCanvasNow();
      });
    }
  }

  drawCanvasNow() {
    const start = performance.now();
    const size = this.resizeCanvas();
    this.ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);
    HoudiniPaintCore.drawBackground(this.ctx, size.cssWidth, size.cssHeight, this.options);
    const duration = performance.now() - start;
    if (duration > this.drawBudgetMs) {
      this.emitStatus(`主线程 Canvas 单次绘制耗时 ${duration.toFixed(1)}ms，已超过 ${this.drawBudgetMs}ms 预算；建议切换静态图`);
    }
    return duration;
  }

  drawCanvasWithOptions(rawOptions) {
    this.scheduleFrameUpdate.cancel();
    this.syncCssVariables(rawOptions);
    return this.drawCanvasNow();
  }

  commitFrameUpdate() {
    this.syncCssVariables(this.options);
    if (this.mode === 'canvas') this.drawCanvasNow();
  }

  handleResize() {
    const size = this.getDevicePixelSize();
    if (size.width === this.lastWidth && size.height === this.lastHeight) return;
    this.lastWidth = size.width;
    this.lastHeight = size.height;

    if (this.mode === 'canvas') {
      this.drawCanvasNow();
    } else if (this.mode === 'image') {
      this.scheduleImage();
    }
  }

  createCacheKey(size) {
    const serializable = Object.fromEntries(Object.entries(this.options).sort(([left], [right]) => left.localeCompare(right)));
    return [
      'custom-background',
      size.width,
      size.height,
      btoa(unescape(encodeURIComponent(JSON.stringify(serializable))))
    ].join(':');
  }

  async rasterizeOnMainThread(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D 上下文不可用');
    HoudiniPaintCore.drawBackground(context, size.width, size.height, this.options);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas 转 PNG 失败，可能受到跨域污染限制'));
      }, 'image/png');
    });
  }

  applyCssFallback(reason) {
    this.mode = 'fallback';
    this.canvas.hidden = true;
    this.stage.classList.remove('mode-worklet', 'mode-image', 'mode-canvas');
    this.stage.classList.add('mode-fallback');
    this.stage.style.backgroundImage = createCssFallbackStyle(this.options);
    this.emitStatus(`已降级为纯 CSS 静态背景（${reason}）；四种图案仍保持渐变+纹理的一致结构`);
  }

  async renderImage() {
    const generation = ++this.imageGeneration;
    const size = this.getDevicePixelSize();
    const key = this.createCacheKey(size);
    const startedAt = performance.now();

    try {
      let blob = null;
      let source = 'cache';
      if (this.cache) {
        blob = await this.cache.getBackground(key);
      }

      if (!blob) {
        source = this.rasterizer ? 'worker' : 'main-thread';
        if (!this.rasterizer) {
          blob = await this.rasterizeOnMainThread(size);
        } else {
          try {
            blob = await this.rasterizer.rasterize({
              width: size.width,
              height: size.height,
              devicePixelRatio: size.ratio,
              options: this.options
            });
          } catch (workerError) {
            console.warn('Worker rasterization failed, using main thread:', workerError);
            this.rasterizer.terminate();
            this.rasterizer = null;
            source = 'main-thread';
            blob = await this.rasterizeOnMainThread(size);
          }
        }
        if (this.cache) await this.cache.putBackground(key, blob).catch(() => {});
      }

      if (generation !== this.imageGeneration || this.mode !== 'image') return null;

      if (this.currentImageUrl) URL.revokeObjectURL(this.currentImageUrl);
      this.currentImageUrl = URL.createObjectURL(blob);
      this.stage.style.backgroundImage = `url("${this.currentImageUrl}")`;
      const duration = performance.now() - startedAt;
      this.lastImageResult = { source, duration, bytes: blob.size, key };
      this.emitStatus(`普通背景图已更新：${source === 'cache' ? 'IndexedDB 缓存' : source === 'worker' ? 'Worker PNG' : '主线程 PNG'}，${duration.toFixed(1)}ms，${blob.size} 字节`);
      return this.lastImageResult;
    } catch (error) {
      if (generation === this.imageGeneration) {
        this.applyCssFallback(error?.message || String(error));
      }
      return null;
    }
  }

  async simulateWorkletFailure(crossOrigin = false) {
    this.workletReady = false;
    if (crossOrigin) {
      this.workletError = '跨域 Paint Worklet 被同源策略拒绝';
    } else {
      this.workletError = 'Worklet 404 或脚本执行失败';
    }
    await this.fallbackFromWorklet(crossOrigin ? 'cross-origin' : 'simulated-load-failure');
  }

  destroy() {
    this.scheduleFrameUpdate.cancel();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else globalThis.removeEventListener('resize', this.resizeThrottler);
    this.scheduleImage.cancel();
    if (this.canvasFrame) cancelAnimationFrame(this.canvasFrame);
    if (this.currentImageUrl) URL.revokeObjectURL(this.currentImageUrl);
  }
}
