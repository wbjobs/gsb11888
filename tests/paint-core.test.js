import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vm.runInThisContext(readFileSync(fileURLToPath(new URL('../js/paint-core.js', import.meta.url))), { filename: 'paint-core.js' });
const core = globalThis.HoudiniPaintCore;

class MockGradient {
  constructor() {
    this.stops = [];
  }

  addColorStop(offset, color) {
    this.stops.push([offset, color]);
  }
}

class MockContext {
  constructor() {
    this.gradient = new MockGradient();
    this.calls = [];
  }

  save() { this.calls.push(['save']); }
  restore() { this.calls.push(['restore']); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
  translate(...args) { this.calls.push(['translate', ...args]); }
  rotate(...args) { this.calls.push(['rotate', ...args]); }
  arc(...args) { this.calls.push(['arc', ...args]); }
  beginPath() { this.calls.push(['beginPath']); }
  fill() { this.calls.push(['fill']); }
  createLinearGradient(...args) {
    this.calls.push(['createLinearGradient', ...args]);
    return this.gradient;
  }
}

test('valid CSS variables are parsed into bounded numeric options', () => {
  const { options, warnings } = core.parsePaintOptions({
    pattern: 'particles',
    density: '0.8',
    angle: '380',
    seed: '42',
    particleSize: '3'
  });

  assert.equal(options.pattern, 'particles');
  assert.equal(options.density, 0.8);
  assert.equal(options.angle, 360);
  assert.equal(options.seed, 42);
  assert.deepEqual(warnings, []);
});

test('invalid CSS variable types fall back and report warnings without throwing', () => {
  const { options, warnings } = core.parsePaintOptions({
    pattern: 'invalid',
    density: 'not-a-number',
    angle: 'crash',
    color1: 'not-a-color'
  });

  assert.equal(options.pattern, 'gradient');
  assert.equal(options.density, core.DEFAULT_OPTIONS.density);
  assert.equal(options.angle, core.DEFAULT_OPTIONS.angle);
  assert.equal(options.color1, core.DEFAULT_OPTIONS.color1);
  assert.equal(warnings.length, 4);
});

test('drawer supports all four patterns and zero size', () => {
  for (const pattern of core.PATTERNS) {
    const context = new MockContext();
    const result = core.drawBackground(context, 80, 60, { pattern, density: 0.7, seed: 7 });
    assert.equal(result.options.pattern, pattern);
    assert.ok(context.calls.some(([name]) => name === 'createLinearGradient'));
  }

  const context = new MockContext();
  const result = core.drawBackground(context, 0, 0, {});
  assert.equal(result.options.pattern, 'gradient');
  assert.equal(context.calls.length, 0);
});

test('random generator is deterministic by seed', () => {
  const first = Array.from({ length: 5 }, core.mulberry32(99));
  const second = Array.from({ length: 5 }, core.mulberry32(99));
  assert.deepEqual(first, second);
});
