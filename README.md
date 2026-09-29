# CSS Houdini Paint Worklet 背景图案实验室

用 Paint Worklet 注册自定义画笔 `pattern-bg`，在 Worklet 中用 Canvas 2D 绘制
渐变 / 噪点 / 条纹 / 粒子背景，支持 CSS 变量实时传参、尺寸变化自动重绘，
并与普通背景图、Canvas 覆盖层做渲染性能对照。

## 运行

Paint Worklet 模块必须通过 HTTP(S) 加载（`file://` 会被拒绝）：

```bash
cd B
python3 -m http.server 8080
# 打开 http://localhost:8080
```

建议使用 Chrome / Edge（Paint Worklet 支持最完整）。Firefox/Safari 会自动走降级路径。

## 文件结构

- `index.html` — 演示页：控件、三张对照卡片、性能表格
- `css/styles.css` — 样式；`paint(pattern-bg)` 仅在 `.worklet-on` 时启用
- `js/paint-worklet.js` — Worklet 内的自定义画笔（含非法值钳制与异常保底）
- `js/worker.js` — Web Worker，后台预生成粒子数据
- `js/main.js` — 特性检测、registerProperty、降级、rAF 节流、性能压测
- `js/db.js` — IndexedDB：缓存降级静态图 + 持久化压测结果

## 验收标准对照

| 验收项 | 实现 |
|---|---|
| 自定义绘制正确 | `paint-worklet.js` 注册 `pattern-bg`，渐变/条纹/噪点/粒子可单独或叠加 |
| CSS 变量传参生效 | `registerProperty` 注册 `--pattern-hue` 等，控件实时改写 |
| 尺寸变化重绘 | Worklet 随元素几何自动重绘；Canvas 覆盖层用 ResizeObserver 重绘 |
| 性能对照可量化 | 压测统计平均帧/P95 帧/掉帧/长任务/覆盖层绘制耗时，结果入 IndexedDB |
| 不支持时降级 | 无 `CSS.paintWorklet` 时主线程生成同款 dataURL 静态背景 |
| 加载失败提示 | `addModule` catch 后顶部通知条提示并自动降级 |
| 变量类型错误不崩 | 注册类型自动回退 initial-value + Worklet 内 clamp + 异常保底纯色 |
| 高频属性变化节流 | 所有变量写入经 rAF 合帧，每帧最多应用一次 |
| 降级样式一致 | 降级与 Worklet 共用同一套确定性绘制算法（同 seed 同结果） |
| 主线程不卡 | 绘制在 Worklet 线程；粒子数据在 Web Worker 生成；压测可验证长任务数 |

## 性能压测说明

点击「运行 4s 性能压测」：持续高频修改色相变量并周期性抖动卡片高度，
通过 rAF 采样帧耗时、`PerformanceObserver` 统计 longtask。
对比三张卡片可观察：Worklet 绘制不占用主线程，而 Canvas 覆盖层的
`renderPattern` 耗时（表格最后一列）直接发生在主线程。
