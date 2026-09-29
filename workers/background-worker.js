importScripts('../js/paint-core.js');

function rasterize({ width, height, devicePixelRatio, options }) {
  const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  globalThis.HoudiniPaintCore.drawBackground(
    ctx,
    width,
    height,
    options
  );
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (event) => {
  const { id, width, height, devicePixelRatio, options } = event.data;
  try {
    const blob = await rasterize({ width, height, devicePixelRatio, options });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
