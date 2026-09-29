/* 主线程逻辑：特性检测 / 注册属性 / 降级 / 节流 / 性能对照 */
'use strict';

// ---------- 与 Worklet 相同的确定性绘制（用于降级静态背景 & Canvas 覆盖层） ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hsl = (h, s, l, a) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;

function renderPattern(ctx, w, h, p) {
  const rand = mulberry32(p.seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, hsl(p.hue, 70, 55, 1));
  g.addColorStop(1, hsl(p.hue2, 70, 45, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (p.type === 'stripes' || p.type === 'full') {
    const spacing = Math.max(6, 80 - p.density * 0.7);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 6);
    const diag = Math.sqrt(w * w + h * h);
    ctx.fillStyle = hsl(p.hue + 40, 60, 60, 0.18);
    for (let x = -diag / 2; x < diag / 2; x += spacing) {
      ctx.fillRect(x, -diag / 2, spacing * 0.4, diag);
    }
    ctx.restore();
  }
  if (p.type === 'noise' || p.type === 'full') {
    const count = Math.min(4000, Math.floor((w * h) / 400 * (p.density / 50)));
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = hsl(p.hue + rand() * 60 - 30, 80, 70, rand() * 0.25);
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, rand() * 1.6 + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if ((p.type === 'particles' || p.type === 'full') && p.particles) {
    for (const item of p.particles.split(';').slice(0, 600)) {
      const [px, py, pr] = item.split(',').map(Number);
      if (![px, py, pr].every(Number.isFinite)) continue;
      const r = Math.max(0.5, pr * 6);
      const x = px * w, y = py * h;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      rg.addColorStop(0, hsl(p.hue + pr * 120, 90, 70, 0.8));
      rg.addColorStop(1, hsl(p.hue, 90, 60, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- 状态 ----------
const params = { type: 'full', hue: 210, hue2: 280, density: 50, seed: 42, particles: '' };
let workletReady = false;
let perfObserver = null;
let longtaskCount = 0;

const $ = (id) => document.getElementById(id);
const workletCard = $('card-worklet');
const staticCard = $('card-static');
const canvasCard = $('card-canvas');
const overlayCanvas = $('overlay-canvas');

// ---------- 通知 ----------
function notify(msg, level = 'info') {
  const bar = $('notice');
  bar.textContent = msg;
  bar.className = 'notice show ' + level;
}

// ---------- 注册自定义属性（类型错误时自动回退 initial-value，不会崩） ----------
function registerProps() {
  const defs = [
    ['--pattern-hue', '<number>', '210'],
    ['--pattern-hue2', '<number>', '280'],
    ['--pattern-density', '<number>', '50'],
    ['--pattern-seed', '<number>', '42'],
  ];
  for (const [name, syntax, initialValue] of defs) {
    try {
      CSS.registerProperty({ name, syntax, inherits: true, initialValue });
    } catch (e) {
      console.warn('registerProperty 失败（可能已注册或不支持）:', name, e);
    }
  }
}

// ---------- 加载 Paint Worklet（处理不支持 / 加载失败 / 跨域） ----------
async function initWorklet() {
  if (!('paintWorklet' in CSS)) {
    notify('当前浏览器不支持 CSS Paint Worklet，已降级为静态背景。', 'warn');
    enableFallback();
    return;
  }
  try {
    // 同源加载；跨域或 404 会在此 reject
    await CSS.paintWorklet.addModule('js/paint-worklet.js');
    workletReady = true;
    workletCard.classList.add('worklet-on');
    notify('Paint Worklet 加载成功，自定义画笔已注册。', 'ok');
  } catch (e) {
    console.error('Worklet 加载失败:', e);
    notify('Paint Worklet 加载失败（' + (e && e.message || e) + '），已降级为静态背景。', 'error');
    enableFallback();
  }
}

// ---------- 降级：静态背景图（主线程 Canvas 生成 dataURL，样式与 Worklet 一致） ----------
async function enableFallback() {
  workletCard.classList.remove('worklet-on');
  workletCard.classList.add('fallback-on');
  await updateStaticBackground(workletCard);
}

async function updateStaticBackground(el) {
  const key = `bg:${params.type}:${params.hue}:${params.hue2}:${params.density}:${params.seed}`;
  let url = null;
  try { url = await idbGet('cache', key); } catch (_) { /* IndexedDB 不可用则跳过缓存 */ }
  if (!url) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 320;
    renderPattern(c.getContext('2d'), c.width, c.height, params);
    url = c.toDataURL('image/png');
    try { await idbPut('cache', url, key); } catch (_) { /* 忽略缓存失败 */ }
  }
  el.style.backgroundImage = `url(${url})`;
  el.style.backgroundSize = 'cover';
}

// ---------- 三种模式同步应用参数 ----------
function applyParams() {
  const targets = [workletCard, staticCard, canvasCard];
  for (const el of targets) {
    el.style.setProperty('--pattern-type', params.type);
    el.style.setProperty('--pattern-hue', params.hue);
    el.style.setProperty('--pattern-hue2', params.hue2);
    el.style.setProperty('--pattern-density', params.density);
    el.style.setProperty('--pattern-seed', params.seed);
    el.style.setProperty('--pattern-particles', params.particles);
  }
  // 静态背景卡：始终用 dataURL（作为“普通背景图”对照组）
  updateStaticBackground(staticCard);
  // Canvas 覆盖层：显式重绘
  drawOverlay();
  // 降级模式下同步刷新
  if (!workletReady) updateStaticBackground(workletCard);
}

// ---------- Canvas 覆盖层（对照组 2，含显式绘制耗时统计） ----------
let lastOverlayDrawMs = 0;
function drawOverlay() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvasCard.clientWidth, h = canvasCard.clientHeight;
  if (!w || !h) return;
  if (overlayCanvas.width !== w * dpr || overlayCanvas.height !== h * dpr) {
    overlayCanvas.width = w * dpr;
    overlayCanvas.height = h * dpr;
  }
  const ctx = overlayCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t0 = performance.now();
  renderPattern(ctx, w, h, params);
  lastOverlayDrawMs = performance.now() - t0;
}

// ---------- 高频属性变化节流：rAF 合帧 ----------
let pendingApply = false;
function scheduleApply() {
  if (pendingApply) return;
  pendingApply = true;
  requestAnimationFrame(() => {
    pendingApply = false;
    applyParams();
  });
}

// ---------- Web Worker 生成粒子 ----------
let particleWorker = null;
let particleReqId = 0;
function requestParticles() {
  if (!window.Worker) { params.particles = ''; scheduleApply(); return; }
  if (!particleWorker) {
    particleWorker = new Worker('js/worker.js');
    particleWorker.onmessage = (e) => {
      if (e.data.reqId === particleReqId) {
        params.particles = e.data.particles;
        scheduleApply();
      }
    };
    particleWorker.onerror = () => { params.particles = ''; scheduleApply(); };
  }
  const reqId = ++particleReqId;
  particleWorker.postMessage({ seed: params.seed, count: 120, reqId });
}

// ---------- 尺寸变化：Worklet 自动重绘；Canvas 覆盖层需手动 ----------
function initResize() {
  const ro = new ResizeObserver(() => scheduleApply());
  ro.observe(canvasCard);
  // 拖动分隔测试：改变卡片高度验证重绘
  $('resize-slider').addEventListener('input', (e) => {
    document.querySelectorAll('.card').forEach(c => { c.style.height = e.target.value + 'px'; });
    scheduleApply();
  });
}

// ---------- 性能测量 ----------
function initPerfObserver() {
  if (!('PerformanceObserver' in window)) return;
  try {
    perfObserver = new PerformanceObserver((list) => {
      longtaskCount += list.getEntries().length;
    });
    perfObserver.observe({ entryTypes: ['longtask'] });
  } catch (_) { /* 某些浏览器不支持 longtask */ }
}

// 压测：高频修改 hue（模拟属性风暴）+ 连续改变尺寸，统计主线程帧耗时
async function runStressTest() {
  const btn = $('stress-btn');
  btn.disabled = true;
  notify('压测进行中：高频属性变化 + 尺寸变化，约 4 秒…', 'info');

  longtaskCount = 0;
  const frames = [];
  let lastFrame = performance.now();
  let running = true;
  const frameLoop = (t) => {
    frames.push(t - lastFrame);
    lastFrame = t;
    if (running) requestAnimationFrame(frameLoop);
  };
  requestAnimationFrame(frameLoop);

  const t0 = performance.now();
  let i = 0;
  await new Promise((resolve) => {
    const tick = () => {
      // 高频属性变化（rAF 节流保证每帧最多一次应用）
      params.hue = (params.hue + 7) % 360;
      params.hue2 = (params.hue2 + 5) % 360;
      scheduleApply();
      // 周期性尺寸抖动
      if (i % 10 === 0) {
        const h = 180 + Math.round(60 * Math.sin(i / 8));
        document.querySelectorAll('.card').forEach(c => { c.style.height = h + 'px'; });
      }
      i++;
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else { running = false; resolve(); }
    };
    tick();
  });

  frames.shift();
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((s, v) => s + v, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const jank = frames.filter(f => f > 32).length; // 掉帧（>2 帧时长）

  const result = {
    time: new Date().toISOString(),
    workletActive: workletReady,
    frames: frames.length,
    avgFrameMs: +avg.toFixed(2),
    p95FrameMs: +p95.toFixed(2),
    jankFrames: jank,
    longtasks: longtaskCount,
    overlayDrawMs: +lastOverlayDrawMs.toFixed(2),
  };
  renderPerfRow(result);
  try { await idbPut('perf', result); } catch (_) { /* 忽略持久化失败 */ }
  notify(`压测完成：平均帧 ${result.avgFrameMs}ms，P95 ${result.p95FrameMs}ms，长任务 ${result.longtasks} 个。`, 'ok');
  btn.disabled = false;
}

function renderPerfRow(r) {
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td>${r.time.slice(11, 19)}</td>` +
    `<td>${r.workletActive ? 'Worklet' : '降级(静态图)'}</td>` +
    `<td>${r.frames}</td><td>${r.avgFrameMs}</td><td>${r.p95FrameMs}</td>` +
    `<td>${r.jankFrames}</td><td>${r.longtasks}</td><td>${r.overlayDrawMs}</td>`;
  $('perf-body').prepend(tr);
}

async function loadPerfHistory() {
  try {
    const rows = await idbAll('perf');
    rows.slice(-10).reverse().forEach(renderPerfRow);
  } catch (_) { /* 无历史 */ }
}

// ---------- 控件绑定 ----------
function bindControls() {
  const bind = (id, key, parse = Number) => {
    $(id).addEventListener('input', (e) => {
      const v = parse(e.target.value);
      // 类型错误保护：非法输入直接忽略，不写入变量
      if (parse === Number && !Number.isFinite(v)) return;
      params[key] = v;
      scheduleApply();
    });
  };
  bind('ctl-hue', 'hue');
  bind('ctl-hue2', 'hue2');
  bind('ctl-density', 'density');
  bind('ctl-seed', 'seed');
  $('ctl-type').addEventListener('change', (e) => { params.type = e.target.value; scheduleApply(); });
  $('ctl-seed').addEventListener('change', requestParticles);
  $('stress-btn').addEventListener('click', runStressTest);
  // 演示“类型错误不崩”：直接写入非法值
  $('bad-value-btn').addEventListener('click', () => {
    workletCard.style.setProperty('--pattern-hue', 'not-a-number');
    workletCard.style.setProperty('--pattern-density', '999999abc');
    notify('已注入非法 CSS 变量值：注册类型会回退到初始值，Worklet 内部也会钳制，页面未崩溃。', 'warn');
  });
}

// ---------- 启动 ----------
(async function main() {
  registerProps();
  bindControls();
  initResize();
  initPerfObserver();
  loadPerfHistory();
  requestParticles(); // 粒子就绪后会触发 scheduleApply
  await initWorklet();
  applyParams();
})();
