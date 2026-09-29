// Paint Worklet: pattern-bg
// 在独立 Worklet 作用域中运行，无法访问 DOM / window。
// 所有参数通过 CSS 自定义属性传入，任何非法值都必须被安全降级。

function safeNumber(props, name, fallback, min, max) {
  try {
    const raw = props.get(name);
    if (!raw) return fallback;
    const v = parseFloat(raw.toString());
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  } catch (e) {
    return fallback;
  }
}

function safeString(props, name, fallback) {
  try {
    const raw = props.get(name);
    if (!raw) return fallback;
    const v = raw.toString().trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

// 确定性 PRNG（mulberry32），保证同一 seed 每次绘制结果一致
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h, s, l, a) {
  return `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
}

function drawGradient(ctx, w, h, hue1, hue2) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, hsl(hue1, 70, 55, 1));
  g.addColorStop(1, hsl(hue2, 70, 45, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawStripes(ctx, w, h, hue, density, rand) {
  const spacing = Math.max(6, 80 - density * 0.7); // density 越大条纹越密
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const diag = Math.sqrt(w * w + h * h);
  ctx.fillStyle = hsl(hue + 40, 60, 60, 0.18);
  for (let x = -diag / 2; x < diag / 2; x += spacing) {
    ctx.fillRect(x, -diag / 2, spacing * 0.4, diag);
  }
  ctx.restore();
}

function drawNoise(ctx, w, h, hue, density, rand) {
  // 用小圆点模拟噪点，数量随面积与 density 缩放，并设置硬上限防止卡死
  const count = Math.min(4000, Math.floor((w * h) / 400 * (density / 50)));
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rand() * 1.6 + 0.4;
    ctx.fillStyle = hsl(hue + rand() * 60 - 30, 80, 70, rand() * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles(ctx, w, h, hue, particlesStr, rand) {
  // 粒子数据由 Web Worker 预生成，格式: "x,y,r;x,y,r;..."（0~1 归一化坐标）
  if (!particlesStr) return;
  const items = particlesStr.split(';');
  const max = Math.min(items.length, 600); // 硬上限
  for (let i = 0; i < max; i++) {
    const parts = items[i].split(',');
    if (parts.length !== 3) continue;
    const px = parseFloat(parts[0]);
    const py = parseFloat(parts[1]);
    const pr = parseFloat(parts[2]);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pr)) continue;
    const r = Math.max(0.5, pr * 6);
    const x = px * w;
    const y = py * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, hsl(hue + pr * 120, 90, 70, 0.8));
    g.addColorStop(1, hsl(hue, 90, 60, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class PatternBgPainter {
  static get inputProperties() {
    return [
      '--pattern-type',
      '--pattern-hue',
      '--pattern-hue2',
      '--pattern-density',
      '--pattern-seed',
      '--pattern-particles',
    ];
  }

  paint(ctx, geom, props) {
    try {
      const w = geom.width;
      const h = geom.height;
      if (w <= 0 || h <= 0) return;

      const type = safeString(props, '--pattern-type', 'gradient');
      const hue = safeNumber(props, '--pattern-hue', 210, 0, 360);
      const hue2 = safeNumber(props, '--pattern-hue2', 280, 0, 360);
      const density = safeNumber(props, '--pattern-density', 50, 0, 100);
      const seed = safeNumber(props, '--pattern-seed', 42, 0, 1e9);
      const particles = safeString(props, '--pattern-particles', '');
      const rand = mulberry32(seed);

      drawGradient(ctx, w, h, hue, hue2);
      if (type === 'stripes' || type === 'full') drawStripes(ctx, w, h, hue, density, rand);
      if (type === 'noise' || type === 'full') drawNoise(ctx, w, h, hue, density, rand);
      if (type === 'particles' || type === 'full') drawParticles(ctx, w, h, hue, particles, rand);
    } catch (e) {
      // 任何异常都不能让绘制崩溃：保底纯色
      try {
        ctx.fillStyle = '#334';
        ctx.fillRect(0, 0, geom.width, geom.height);
      } catch (_) { /* 放弃 */ }
    }
  }
}

registerPaint('pattern-bg', PatternBgPainter);
