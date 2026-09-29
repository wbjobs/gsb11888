# CSS Houdini Paint Worklet 动态背景

一个无构建步骤的原生前端示例：用同一份 Canvas 2D 绘制器实现渐变、噪点、条纹、粒子，并在 Paint Worklet、普通背景图、Canvas 覆盖层之间切换和做性能对照。

## 运行

```bash
npm start
# http://localhost:3000
```

Paint Worklet 和 Web Worker 都要求 HTTP(S) 同源环境，不能直接用 `file://` 打开。

```bash
npm test
```

## 文件结构

- `worklet/background-paint.js`：注册 `paint(custom-background)`，声明并读取 CSS 自定义属性。
- `js/paint-core.js`：三种渲染路径共享的参数校验、随机数和 Canvas 2D 绘制器。
- `workers/background-worker.js`：使用 `OffscreenCanvas` 离线程生成 PNG。
- `js/background-renderer.js`：Worklet 注册、模式切换、`ResizeObserver` 重绘、失败降级。
- `js/background-cache.js`：IndexedDB 缓存静态 PNG 与基准测试结果。
- `js/perf-monitor.js`：`PerformanceObserver` 收集长任务和 measure。
- `js/benchmark.js`：依次对 Worklet、普通背景图、Canvas 覆盖层运行 4 秒测试。
- `css/styles.css`：演示页样式与纯 CSS 最终降级。
- `server.mjs`：同源静态服务器，返回正确 JS MIME 和 `Cross-Origin-Resource-Policy: same-origin`。

## CSS 变量

Worklet 监听以下属性，属性变化或元素尺寸变化会触发重绘：

- `--bg-pattern`：`gradient | noise | stripes | particles`
- `--bg-color-1`、`--bg-color-2`
- `--bg-density`、`--bg-angle`、`--bg-opacity`
- `--bg-seed`、`--bg-stripe-width`、`--bg-particle-size`

参数先经过白名单、正则、范围和整数处理。非法颜色或数字会回退到安全默认值，并在页面提示，不抛出异常。

## 降级链路

1. 首选 Paint Worklet：CSS 变量驱动，元素尺寸变化由浏览器自动调用 `paint()`。
2. 不支持、加载超时、404、脚本错误或跨域时：切换到普通背景图。
3. 普通背景图由 Web Worker + `OffscreenCanvas` 生成，同参数和尺寸命中 IndexedDB；Worker 不可用时在主线程生成一次。
4. 图片生成失败、Canvas 被跨域污染或 Canvas 不可用时：使用结构一致的纯 CSS 多层渐变。

“模拟跨域限制”按钮会演示 Worklet 的同源限制。当前绘制器本身不读取外部图片，因此不会污染 Canvas；如后续接入外部素材，应使用 CORS 响应并设置 `crossOrigin="anonymous"`。

## 高频更新与性能

- Canvas 覆盖层：输入事件用 `requestAnimationFrame` 合并，每帧最多完整重绘一次。
- 普通背景图：参数变化做 180ms debounce，尺寸稳定后再让 Worker 栅格化。
- Worklet：由浏览器在绘制阶段响应 CSS 变量和尺寸变化。
- Worker 把像素生成移出主线程，静态 PNG 由合成器处理。
- Canvas 单次绘制超过 12ms 会提示绘制预算不足。

基准测试记录：

- FPS 与总帧数
- P95 帧间隔和大于 24ms 的掉帧数
- `PerformanceObserver` 捕获的长任务数量和总时长
- 主线程同步更新/绘制平均耗时
- 当前设备像素尺寸

普通背景图模式不逐帧重新生成 PNG；测试通过不断更新 `background-position` 测量合成位移成本。

## 验收对照

- 自定义绘制正确：四种图案由 `js/paint-core.js` 统一实现并有 Node 测试。
- CSS 变量传参生效：Worklet 声明 `inputProperties`，控制器实时写入变量。
- 尺寸变化重绘：Worklet 自动重绘；Canvas 和图片由 ResizeObserver/rAF/debounce 处理。
- 性能可量化：页面表格输出 FPS、P95、掉帧、长任务和绘制耗时。
- 不支持有降级：自动走 Worker 静态图，再走纯 CSS。
- 加载失败有提示：状态区展示原因并显示当前模式。
- 类型错误不崩：非法变量被替换为默认值并列出警告。
- 高频变化有节流：Canvas rAF 合并，图片 debounce。
- 降级样式一致：Worklet、Worker、主线程 Canvas 使用同一绘制函数；CSS 兜底保留渐变和纹理层次。
- 主线程不卡：重像素绘制放入 Worker，并有长任务指标量化。
