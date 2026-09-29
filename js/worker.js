// Web Worker: 在后台线程预生成粒子数据，避免主线程计算卡顿。
// 接收 { seed, count }，返回 "x,y,r;x,y,r;..." 归一化粒子串。

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

self.onmessage = (e) => {
  const { seed, count, reqId } = e.data || {};
  const rand = mulberry32(Number.isFinite(seed) ? seed : 42);
  const n = Math.min(600, Math.max(0, count | 0));
  const parts = new Array(n);
  for (let i = 0; i < n; i++) {
    parts[i] = rand().toFixed(4) + ',' + rand().toFixed(4) + ',' + rand().toFixed(4);
  }
  self.postMessage({ reqId, particles: parts.join(';') });
};
