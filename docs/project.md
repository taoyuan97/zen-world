# 禅境世界 Zen World — 项目概况

| 项目 | 内容 |
|---|---|
| 项目类型 | 浏览器 3D 冥想收集小游戏（单机、无后端） |
| 当前阶段 | 设计文档完成，待进入 M1 开发 |
| 创建日期 | 2026-07-19 |
| 技术栈 | Three.js + Vite + TypeScript（strict） |
| 运行平台 | 桌面浏览器（Chrome / Edge / Safari 最新版） |
| 美术风格 | 低多边形（Low-Poly）禅意风 |
| 语言 | 仅中文 |

---

## 1. 一句话介绍

探索一张有 10 座小山的禅意地图，点击进山与冥想老师对话，完成 5~10 分钟文字引导冥想后将山永久点亮——目标是点亮全部 10 座山。

**核心体验**：无失败、无竞争、无惩罚的"5~10 分钟数字避静"；单次会话约 8~15 分钟。

## 2. 文档导航

| 文档 | 路径 | 内容 |
|---|---|---|
| 游戏设计（GDD） | [docs/gdd/zen-world-gdd.md](gdd/zen-world-gdd.md) | 玩法循环、10 山主题与老师设定、系统设计、美术规范、JSON 模板附录 |
| 技术设计（TDD） | [docs/tdd/zen-world-tdd.md](tdd/zen-world-tdd.md) | 架构分层、模块接口、数据流、性能方案、TS 类型与事件清单附录 |
| 任务总览 | [docs/task/task-overview.md](task/task-overview.md) | 已确认决策记录、里程碑总览与依赖、全局完成定义（DoD） |
| M1 地图原型 | [docs/task/m1-map-prototype.md](task/m1-map-prototype.md) | 13 个任务（~7 人日）：脚手架、地形、10 山、拾取、存档双态 |
| M2 垂直切片 | [docs/task/m2-vertical-slice.md](task/m2-vertical-slice.md) | 14 个任务（~11 人日）：青竹林完整闭环（对话→冥想→点亮） |
| M3 内容铺开 | [docs/task/m3-content-rollout.md](task/m3-content-rollout.md) | 9 个任务（~10 人日）：9 山主题 + 全部对话/引导文案 |
| M4 体验打磨 | [docs/task/m4-polish.md](task/m4-polish.md) | 9 个任务（~8 人日）：环境音、TTS、终局演出、性能收尾 |

## 3. 已确认决策（2026-07-19）

| # | 决策 | 结论 |
|---|---|---|
| A1 | 老师形象 | CC0 GLB 成品模型，统一归一化；失败回退程序化拼装 |
| A2 | MVP 音频 | WebAudio 合成占位音（钵音、点击音）；正式音频留 M4 |
| A3 | 文案 | 10 位老师对话 + 20 份引导词由 AI 起草，M3 验收逐山校对 |
| A4 | 语言 | 仅中文 |
| A5 | 冥想计时 UI | 圆环 + 剩余分钟数字，可一键隐藏 |
| A6 | 新手引导 | 首次进地图一次性极简操作提示（3s 淡出） |
| A7 | 部署 | 仅本地预览；产物保持静态站形态 |

**到点再议**：B1 TTS 路线（M3 结束时）、B2 10/10 终局范围（M4 开工前）、B3 呼吸节奏差异化（M3 文案阶段）、B4 重复冥想激励（M3 结束时）。

## 4. 玩法概要

- **主场景**：低模禅意地形 + 10 座小山，OrbitControls 旋转/缩放浏览；未点亮的山灰暗笼雾，点亮后暖灯萤火。
- **冥想场景**：每山一主题（竹林/雪顶/湖畔/星空/沙漠/樱花/雾谷/草原/温泉/古寺），一位老师；点击老师 → 2~4 轮对话 → 选 5/10 分钟 → 文字引导 + 计时冥想。
- **进度**：冥想完成 → 点亮演出 → 回地图山变亮；进度存 localStorage，已点亮的山可重复冥想并累计时长。

## 5. 技术要点

- **架构四层**：UI（原生 DOM 浮层）→ 系统（对话/会话/演出/存档）→ 场景（Map/Meditation）→ 核心（GameApp/SceneManager/AssetLoader/EventBus/Timeline）。
- **数据驱动红线**：10 山全部差异收敛到 `src/data/` JSON（hills.json + 对话 + 引导词），代码零硬编码主题。
- **计时可靠性**：冥想用 `performance.now()` 差值计时，标签页隐藏自动暂停。
- **性能预算**：单场景 < 50k 三角面、draw calls < 80、桌面中端 60fps；装饰一律 InstancedMesh。
- **依赖最小化**：运行时仅 `three`（M4 加 `howler`），不引入 UI 框架。

## 6. 里程碑计划

```
M1 地图原型（~7d）→ M2 青竹林闭环（~11d）→ M3 内容铺开（~10d）→ M4 体验打磨（~8d）→ v1.0
```

严格串行；每个里程碑以对应任务文档的验收清单逐条浏览器实测通过为准。

## 7. 仓库结构（规划）

```
zen-world/
├── docs/                 # 本文档 + gdd/ + tdd/ + task/
├── index.html            # 画布 + UI 浮层静态骨架（M1 建）
├── package.json / vite.config.ts / tsconfig.json
├── public/assets/        # 模型（CC0 GLB）、音频（M4）
└── src/
    ├── core/             # GameApp SceneManager AssetLoader EventBus Tween Timeline
    ├── scenes/           # MapScene MeditationScene
    ├── systems/          # SaveSystem DialogueSystem MeditationSession LightingRitual
    ├── ui/               # UIManager DialogueBox MeditationHud screens
    └── data/             # hills.json dialogues/ meditations/ types.ts
```

## 8. 开发与验收约定

- 开发预览：`npm run dev`；构建：`npm run build`（含 `tsc --noEmit`）。
- 调试开关：`?debug`（性能面板 + 点亮调试）、`?hill=<id>`（直进场景，M2 起）。
- 素材全部 CC0（Quaternius / Kenney / Poly Pizza / Freesound），许可记录随素材入库。
- 任务 DoD：构建零错误、浏览器实测通过、无 console 报错、数据校验通过。

## 9. 当前状态与下一步

- [x] 需求确认与方案梳理
- [x] GDD v0.1 / TDD v0.1 / 任务文档 v0.1
- [x] M1 地图原型（2026-07-20 浏览器验收通过）
- [ ] **下一步：M2 青竹林垂直切片**（依 [m2-vertical-slice.md](task/m2-vertical-slice.md) 任务 2.1~2.14）

---

*维护说明：里程碑验收或决策变更时更新本文"当前状态"与"已确认决策"两节；细节一律以 GDD/TDD/任务文档为准。*
