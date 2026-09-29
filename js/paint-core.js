((global) => {
  const DEFAULT_OPTIONS = {
    pattern: 'gradient',
    color1: '#2563eb',
    color2: '#ec4899',
    density: 0.55,
    angle: 28,
    opacity: 1,
    seed: 1337,
    stripeWidth: 28,
    particleSize: 2.4
  };

  const PATTERNS = new Set(['gradient', 'noise', 'stripes', 'particles']);

  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RGB_COLOR = /^rgba?\(\s*(?:\d{1,3}|\d*(?:\.\d+)?%)(?:\s*,\s*|\s+)(?:\d{1,3}|\d*(?:\.\d+)?%)(?:\s*,\s*|\s+)(?:\d{1,3}|\d*(?:\.\d+)?%)(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
  const HSL_COLOR = /^hsla?\(\s*-?\d{1,3}(?:deg)?(?:\s*,\s*|\s+)\d{1,3}%(?:\s*,\s*|\s+)\d{1,3}%(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
  const NUMBER = /^[+-]?(?:\d*\.?\d+)(?:e[+-]?\d+)?$/i;

  function createDefaultOptions() {
    return { ...DEFAULT_OPTIONS };
  }

  function isValidColor(value) {
    return HEX_COLOR.test(value) || RGB_COLOR.test(value) || HSL_COLOR.test(value);
  }

  function readField(source, key) {
    if (source === null || source === undefined) return undefined;
    const value = source[key];
    if (value === null || value === undefined) return undefined;
    return String(value).trim();
  }

  function parseNumber(value, min, max, { integer = false } = {}) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = integer ? Math.round(value) : value;
      return Math.min(max, Math.max(min, parsed));
    }

    if (typeof value !== 'string' || !NUMBER.test(value.trim())) {
      return { error: true };
    }

    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) return { error: true };
    const result = integer ? Math.round(parsed) : parsed;
    return Math.min(max, Math.max(min, result));
  }

  function parsePaintOptions(input = {}) {
    const warnings = [];
    const options = createDefaultOptions();

    const pattern = readField(input, 'pattern');
    if (pattern !== undefined) {
      if (PATTERNS.has(pattern)) {
        options.pattern = pattern;
      } else {
        warnings.push(`未知图案 "${pattern}"，已回退为 ${DEFAULT_OPTIONS.pattern}`);
      }
    }

    for (const key of ['color1', 'color2']) {
      const color = readField(input, key);
      if (color !== undefined) {
        if (isValidColor(color)) {
          options[key] = color;
        } else {
          warnings.push(`颜色变量 ${key} 类型错误，已使用默认值`);
        }
      }
    }

    const numericFields = [
      ['density', 0, 1, false],
      ['angle', 0, 360, false],
      ['opacity', 0, 1, false],
      ['seed', 0, 999999, true],
      ['stripeWidth', 2, 200, false],
      ['particleSize', 0.5, 24, false]
    ];

    for (const [key, min, max, integer] of numericFields) {
      const raw = readField(input, key);
      if (raw === undefined || raw === '') continue;
      const result = parseNumber(raw, min, max, { integer });
      if (result.error) {
        warnings.push(`数值变量 ${key} 类型错误，已使用安全值`);
      } else {
        options[key] = result;
      }
    }

    return { options, warnings };
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawGradient(ctx, width, height, options) {
    const radians = (options.angle - 90) * Math.PI / 180;
    const x = Math.cos(radians) * width / 2;
    const y = Math.sin(radians) * height / 2;
    const gradient = ctx.createLinearGradient(width / 2 - x, height / 2 - y, width / 2 + x, height / 2 + y);
    gradient.addColorStop(0, options.color1);
    gradient.addColorStop(1, options.color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawStripes(ctx, width, height, options) {
    const diagonal = Math.hypot(width, height);
    const period = Math.max(4, options.stripeWidth * 2);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((options.angle - 90) * Math.PI / 180);
    ctx.globalAlpha = options.opacity * 0.42;
    ctx.fillStyle = options.color2;
    for (let x = -diagonal; x < diagonal; x += period) {
      ctx.fillRect(x, -diagonal, options.stripeWidth, diagonal * 2);
    }
    ctx.restore();
  }

  function drawNoise(ctx, width, height, options, random) {
    const count = Math.min(6000, Math.round(width * height * options.density / 2500));
    ctx.save();
    ctx.fillStyle = options.color2;
    for (let index = 0; index < count; index += 1) {
      const size = 1 + Math.floor(random() * 3);
      ctx.globalAlpha = options.opacity * (0.16 + random() * 0.38);
      ctx.fillRect(random() * width, random() * height, size, size);
    }
    ctx.restore();
  }

  function drawParticles(ctx, width, height, options, random) {
    const count = Math.min(1600, Math.round(width * height * options.density / 650));
    ctx.save();
    ctx.fillStyle = options.color2;
    for (let index = 0; index < count; index += 1) {
      const radius = Math.max(0.4, (0.35 + random() * 1.35) * options.particleSize);
      ctx.globalAlpha = options.opacity * (0.2 + random() * 0.55);
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBackground(ctx, width, height, rawOptions = {}) {
    const parsed = rawOptions.options ? { options: rawOptions, warnings: rawOptions.warnings || [] } : parsePaintOptions(rawOptions);
    const options = parsed.options;
    const canvasWidth = Math.max(0, Math.round(width));
    const canvasHeight = Math.max(0, Math.round(height));
    if (!canvasWidth || !canvasHeight || !ctx) return parsed;

    const random = mulberry32(options.seed);
    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = options.opacity;
    drawGradient(ctx, canvasWidth, canvasHeight, options);
    ctx.restore();

    if (options.pattern === 'stripes') {
      drawStripes(ctx, canvasWidth, canvasHeight, options);
    } else if (options.pattern === 'noise') {
      drawNoise(ctx, canvasWidth, canvasHeight, options, random);
    } else if (options.pattern === 'particles') {
      drawParticles(ctx, canvasWidth, canvasHeight, options, random);
    }

    return parsed;
  }

  const api = {
    PATTERNS,
    DEFAULT_OPTIONS,
    createDefaultOptions,
    isValidColor,
    parsePaintOptions,
    drawBackground,
    mulberry32
  };

  global.HoudiniPaintCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
