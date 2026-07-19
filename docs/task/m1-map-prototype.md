# M1 — 地图原型（任务文档）

| 项目 | 内容 |
|---|---|
| 里程碑目标 | Vite + TS + Three.js 工程可运行；10 座山地图可浏览、可点击进出场景；亮/暗双态与存档打通 |
| 状态 | ✅ 已完成（2026-07-20 浏览器验收通过） |
| 技术依据 | TDD §3（脚手架）、§4（核心层）、§5.1（MapScene）、§6.1（SaveSystem）、§8（数据校验） |
| 入口条件 | 决策 A1~A7 已确认（见 task-overview） |
| 预估 | ~7 人日 |

---

## 1. 任务清单

| # | 任务 | 产出 | 预估 | 依赖 |
|---|---|---|---|---|
| 1.1 | 工程脚手架：`npm create vite`（vanilla-ts）、TS strict、安装 `three` / `@types/three`、`vite.config.ts` 设 `base:'./'` | `npm run dev` 打开空白页无报错 | 0.5d | — |
| 1.2 | index.html 静态 UI 骨架 + style.css（画布容器、HUD 容器、过渡遮罩节点） | UI 层 DOM 骨架 | 0.5d | 1.1 |
| 1.3 | GameApp：渲染器（TDD §4.1 参数）、主循环、dt 钳制 100ms、resize 分发 | 核心渲染循环 | 0.5d | 1.1 |
| 1.4 | EventBus + SceneManager + TransitionOverlay（0.5s 淡入淡出、切换期吞输入） | 场景切换机制 | 1d | 1.3 |
| 1.5 | 数据层：`types.ts`（TDD 附录 A 全套类型）、`hills.json` 10 山完整配置、`validate.ts` 三类校验（含山位间距 ≥ 15） | 数据驱动底座 | 0.5d | 1.1 |
| 1.6 | TerrainBuilder：96×96 噪声地形、flatShading、按高度分带顶点色、水面片、山位平台 | 禅境地基底形 | 1d | 1.3 |
| 1.7 | HillFactory：10 山按 `hills.json` 落位；每山 = 山体 Mesh + PointLight（默认关）+ `userData.hillId`；亮/暗两套顶点色系数 | 10 山双态渲染 | 1d | 1.5, 1.6 |
| 1.8 | OrbitControls：阻尼、俯仰 20°~60°、距离 30~90、禁平移、空闲 5s 自动旋转 | 地图相机 | 0.5d | 1.6 |
| 1.9 | 拾取：pointermove 节流 Raycast、悬停提亮 + Tooltip 山名浮签、click 位移 < 5px 判定 → `hill:selected` | 点击交互 | 0.5d | 1.7, 1.8 |
| 1.10 | SaveSystem：load / markLit / 防抖 300ms / 损坏备份 `.bak` / `?debug` 手动切点亮 | 进度持久化 | 0.5d | 1.5 |
| 1.11 | 场景整合：MapScene enter 按存档渲染双态；占位 MeditationScene（纯色背景 + 返回按钮）可进出 | 闭环打通 | 0.5d | 1.4, 1.9, 1.10 |
| 1.12 | 地图 HUD：进度 x/10、静音占位开关、**一次性新手操作提示**（A6：拖拽旋转/滚轮缩放/点击进山，3s 淡出，存档记录已看） | HUD 完成 | 0.5d | 1.11 |
| 1.13 | `?debug` 面板：fps、draw calls、点亮状态切换按钮；M1 整体验收 | 调试与验收 | 0.5d | 全部 |

## 2. 验收标准（浏览器逐条实测）

- [x] `npm run dev` 启动后地图 60fps（中端桌面），`?debug` 可见 draw calls < 80
- [x] 10 座山位置与 `hills.json` 一致，互不遮挡，旋转/缩放限位生效
- [x] 悬停任意山：山体提亮 + 名称浮签跟随；点击：淡入淡出切换进出占位场景
- [x] `?debug` 切换某山点亮：山体变暖色、灯亮、雾感减弱，1.2s 渐变无跳变
- [x] 刷新页面后点亮状态保留；进度 HUD 显示正确 x/10
- [x] 首次进入显示操作提示且仅显示一次；清空存档后再次出现
- [x] localStorage 写入损坏字符串后刷新：游戏正常启动，原档备份为 `.bak`
- [x] `npm run build` 通过，`dist/` 产物存在

## 3. 风险与备注

- 地形噪声自实现（value-noise 约 20 行），不引第三方库；效果不满意先调参数不换方案。
- 点亮渐变用"两套顶点色数组 + 混合系数 Tween"（TDD §12），禁止逐帧改几何。
- 本里程碑**不做**：老师、对话、冥想计时（全部 M2）；装饰物可先用 1~2 种占位树。
