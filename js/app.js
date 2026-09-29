(() => {
  const $ = (selector) => document.querySelector(selector);

  const elements = {
    stage: $('#stage'),
    canvas: $('#overlayCanvas'),
    status: $('#status'),
    warningList: $('#warningList'),
    supportBadge: $('#supportBadge'),
    currentMode: $('#currentMode'),
    pattern: $('#patternSelect'),
    color1: $('#color1'),
    color2: $('#color2'),
    density: $('#density'),
    angle: $('#angle'),
    opacity: $('#opacity'),
    stripeWidth: $('#stripeWidth'),
    particleSize: $('#particleSize'),
    seed: $('#seed'),
    stageHeight: $('#stageHeight'),
    densityValue: $('#densityValue'),
    angleValue: $('#angleValue'),
    opacityValue: $('#opacityValue'),
    stripeWidthValue: $('#stripeWidthValue'),
    particleSizeValue: $('#particleSizeValue'),
    seedValue: $('#seedValue'),
    heightValue: $('#heightValue'),
    runBenchmark: $('#runBenchmark'),
    benchmarkBody: $('#benchmarkBody'),
    benchmarkProgress: $('#benchmarkProgress')
  };

  let renderer;
  let benchmark;
  let cache = null;

  const modeLabels = {
    worklet: 'Paint Worklet',
    image: '普通背景图',
    canvas: 'Canvas 覆盖层',
    fallback: '纯 CSS 降级'
  };

  function readOptionsFromControls() {
    return {
      pattern: elements.pattern.value,
      color1: elements.color1.value,
      color2: elements.color2.value,
      density: elements.density.value,
      angle: elements.angle.value,
      opacity: elements.opacity.value,
      seed: elements.seed.value,
      stripeWidth: elements.stripeWidth.value,
      particleSize: elements.particleSize.value
    };
  }

  function syncOutputs() {
    elements.densityValue.textContent = Number(elements.density.value).toFixed(2);
    elements.angleValue.textContent = `${elements.angle.value}°`;
    elements.opacityValue.textContent = Number(elements.opacity.value).toFixed(2);
    elements.stripeWidthValue.textContent = `${elements.stripeWidth.value}px`;
    elements.particleSizeValue.textContent = `${Number(elements.particleSize.value).toFixed(1)}px`;
    elements.seedValue.textContent = elements.seed.value;
    elements.heightValue.textContent = `${elements.stageHeight.value}px`;
  }

  function renderStatus({ message, warnings, mode, workletReady }) {
    elements.status.textContent = message;
    elements.currentMode.textContent = modeLabels[mode] || mode;
    elements.warningList.replaceChildren(...warnings.map((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      return item;
    }));

    const supported = 'paintWorklet' in CSS;
    elements.supportBadge.textContent = supported
      ? (workletReady ? 'Paint Worklet 已启用' : 'Paint Worklet 检测到但未启用')
      : 'Paint Worklet 不支持';
    elements.supportBadge.className = `badge ${workletReady ? 'ok' : supported ? '' : 'bad'}`;

    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
      button.disabled = button.dataset.mode === 'worklet' && !workletReady;
    });
  }

  function applyControls({ immediate = false } = {}) {
    syncOutputs();
    renderer.setOptions(readOptionsFromControls(), { immediate });
  }

  function formatNumber(value, digits = 1) {
    return Number(value || 0).toFixed(digits);
  }

  function renderBenchmarkRows(results) {
    elements.benchmarkBody.replaceChildren(...results.map((result) => {
      const row = document.createElement('tr');
      if (result.skipped) {
        row.innerHTML = `<td>${modeLabels[result.mode] || result.mode}</td><td colspan="6">跳过：${result.reason}</td>`;
        return row;
      }

      row.innerHTML = `
        <td><strong>${modeLabels[result.mode] || result.mode}</strong><br><small>${result.width}×${result.height}</small></td>
        <td>${formatNumber(result.fps)}</td>
        <td>${formatNumber(result.p95FrameMs)} ms</td>
        <td>${result.droppedFrames}/${result.frames}</td>
        <td>${result.longTaskCount} 次 / ${formatNumber(result.longTaskTotalMs)} ms</td>
        <td>${formatNumber(result.avgDrawMs, 3)} ms</td>
        <td>${result.note}</td>
      `;
      return row;
    }));
  }

  async function init() {
    const supported = 'paintWorklet' in CSS && typeof Worker !== 'undefined' && elements.canvas.getContext('2d');
    elements.supportBadge.textContent = supported ? '正在注册 Worklet' : '浏览器能力不完整，使用降级';

    try {
      cache = await BackgroundCache.create();
    } catch (error) {
      console.warn('IndexedDB unavailable:', error);
    }

    let rasterizer = null;
    try {
      rasterizer = new WorkerRasterizer('workers/background-worker.js');
    } catch (error) {
      console.warn('Worker unavailable:', error);
    }

    renderer = new BackgroundRenderer({
      stage: elements.stage,
      canvas: elements.canvas,
      cache,
      rasterizer,
      onStatusChange: renderStatus
    });

    const monitor = new PerfMonitor();
    benchmark = new BackgroundBenchmark({
      renderer,
      cache,
      monitor,
      onProgress: (message) => {
        elements.benchmarkProgress.textContent = message;
      }
    });

    renderer.syncCssVariables(readOptionsFromControls());
    await renderer.loadWorklet();
    if (!renderer.workletReady && renderer.mode === 'worklet') {
      await renderer.setMode('image');
    }
    applyControls({ immediate: true });
    bindEvents();
  }

  function bindEvents() {
    const controlKeys = ['pattern', 'color1', 'color2', 'density', 'angle', 'opacity', 'stripeWidth', 'particleSize', 'seed'];
    controlKeys.forEach((key) => {
      elements[key].addEventListener('input', () => applyControls());
      elements[key].addEventListener('change', () => applyControls({ immediate: true }));
    });

    elements.stageHeight.addEventListener('input', () => {
      syncOutputs();
      elements.stage.style.setProperty('--stage-height', `${elements.stageHeight.value}px`);
    });

    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', async () => {
        await renderer.setMode(button.dataset.mode);
      });
    });

    $('#simulateFailure').addEventListener('click', () => renderer.simulateWorkletFailure(false));
    $('#simulateCors').addEventListener('click', () => renderer.simulateWorkletFailure(true));

    $('#injectInvalidVars').addEventListener('click', () => {
      elements.stage.style.setProperty('--bg-density', 'not-a-number');
      elements.stage.style.setProperty('--bg-angle', 'crash');
      elements.stage.style.setProperty('--bg-color-1', 'red-;-color');
      renderer.setOptions({
        density: 'not-a-number',
        angle: 'crash',
        color1: 'red-;-color'
      }, { immediate: true });
    });

    $('#clearCache').addEventListener('click', async () => {
      if (cache) {
        await cache.clearBackgrounds();
        elements.benchmarkProgress.textContent = 'IndexedDB 图片缓存已清空；下次背景图将重新栅格化。';
      }
    });

    $('#reloadPage').addEventListener('click', () => location.reload());

    elements.runBenchmark.addEventListener('click', async () => {
      elements.runBenchmark.disabled = true;
      try {
        const results = await benchmark.run();
        renderBenchmarkRows(results);
        elements.benchmarkProgress.textContent = '基准测试完成，结果也已写入 IndexedDB（若可用）。';
      } finally {
        elements.runBenchmark.disabled = false;
      }
    });
  }

  init().catch((error) => {
    console.error(error);
    elements.status.textContent = `初始化失败：${error.message}；请使用支持 Canvas 的现代浏览器或静态服务器打开。`;
    elements.supportBadge.textContent = '初始化失败';
    elements.supportBadge.className = 'badge bad';
  });
})();
