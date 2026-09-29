import '../js/paint-core.js';

class HoudiniBackgroundPaint {
  static get inputProperties() {
    return [
      '--bg-pattern',
      '--bg-color-1',
      '--bg-color-2',
      '--bg-density',
      '--bg-angle',
      '--bg-opacity',
      '--bg-seed',
      '--bg-stripe-width',
      '--bg-particle-size'
    ];
  }

  paint(ctx, size, properties) {
    const read = (name) => properties.get(name)?.toString().trim();
    const { options } = globalThis.HoudiniPaintCore.parsePaintOptions({
      pattern: read('--bg-pattern'),
      color1: read('--bg-color-1'),
      color2: read('--bg-color-2'),
      density: read('--bg-density'),
      angle: read('--bg-angle'),
      opacity: read('--bg-opacity'),
      seed: read('--bg-seed'),
      stripeWidth: read('--bg-stripe-width'),
      particleSize: read('--bg-particle-size')
    });

    globalThis.HoudiniPaintCore.drawBackground(ctx, size.width, size.height, options);
  }
}

registerPaint('custom-background', HoudiniBackgroundPaint);
