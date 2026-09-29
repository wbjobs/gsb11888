function createRafThrottle(callback) {
  let frameId = 0;
  let pendingArgs = null;

  const throttled = (...args) => {
    pendingArgs = args;
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      const argsToRun = pendingArgs;
      pendingArgs = null;
      callback(...argsToRun);
    });
  };

  throttled.cancel = () => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    pendingArgs = null;
  };

  return throttled;
}

function createDebounce(callback, delay) {
  let timerId = 0;
  const debounced = (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = 0;
      callback(...args);
    }, delay);
  };

  debounced.cancel = () => {
    if (timerId) clearTimeout(timerId);
    timerId = 0;
  };

  return debounced;
}
