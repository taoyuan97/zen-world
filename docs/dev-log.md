# 禅境世界 Zen World — 开发日志

---

## 2026-07-19 ｜ M1 地图原型 — 编码完成，待浏览器验收

### 完成内容

按 [task/m1-map-prototype.md](task/m1-map-prototype.md) 任务 1.1~1.13 全部落地：

| 任务 | 产出 |
|---|---|
| 1.1 脚手架 | Vite 8 + TypeScript 7（strict）+ three 0.185；`vite.config.ts` 设 `base:'./'`；scripts：dev / build（含 `tsc --noEmit`）/ preview |
| 1.2 UI 骨架 | `index.html`（画布 + HUD + 对话框占位节点）+ `src/style.css`（TDD §7 视觉规范：半透明深色底、圆角 12px、衬线字体栈） |
| 1.3 GameApp | `src/core/GameApp.ts`：渲染器（antialias / SRGB / pixelRatio≤2）、主循环 dt 钳制 100ms、resize 分发、滚动 FPS 统计 |
| 1.4 场景切换 | `EventBus.ts`（类型化事件，TDD 附录 B 子集 + `scene:entered` + `debug:toggle-lit`）、`SceneManager.ts`（IScene 生命周期、0.5s 黑场过渡、切换期吞输入）、`ui/TransitionOverlay.ts` |
| 1.5 数据层 | `src/data/types.ts`（TDD 附录 A 全套类型）、`src/data/hills.json`（10 山完整配置：位置/三色/env/teacher/内容路径）、`src/core/validate.ts`（结构/枚举/色值/id 唯一/间距≥15 fail-fast；内容文件存在性留 M2/M3） |
| 1.6 地形 | `src/scenes/map/TerrainBuilder.ts`：96×96 自实现 value-noise FBM 地形、flatShading、按高度分带顶点色、山位压平台、边缘环形远山、水面片 |
| 1.7 山体 | `src/scenes/map/HillFactory.ts`：圆锥+顶点扰动低模山体（山 id 种子确定性随机）、主题三色渐变顶点色；亮/暗双态 = 两套顶点色数组 + Tween 混合（1.2s），顶部暖色 PointLight + 3 灯笼 + 3 占位树 |
| 1.8 相机 | OrbitControls：阻尼、俯仰 20°~60°、距离 30~90、禁平移、空闲 5s 自动旋转（0.3 速） |
| 1.9 拾取 | 每帧最多一次 Raycast、悬停 emissive 提亮 + 山名浮签（世界坐标投影）、点击位移 <5px 判定 → `hill:selected` |
| 1.10 存档 | `src/systems/SaveSystem.ts`：`zen-world-save-v1`、防抖 300ms、损坏备份 `.bak` 并重置、beforeunload/页面隐藏 flush |
| 1.11 场景整合 | MapScene 按存档渲染双态；占位 MeditationScene（主题色空地 + 山影 + 返回按钮）进出闭环 |
| 1.12 HUD | 进度 x/10、静音开关（写入存档）、一次性新手提示（3s 淡出，存档记录，A6） |
| 1.13 调试 | `?debug` 面板：fps / draw calls / 三角面数 / 每山点亮切换按钮 |

### 验证结果

- `npm run build`：tsc --noEmit 零错误，vite 打包成功（dist/ 570 KB，gzip 146 KB；chunk 体积警告来自 three 本体，M4 性能复查时评估分包）
- dev server 冒烟：HTTP 200，页面含 `#scene` / `#map-hud` / `/src/main.ts` 挂载点；测试后进程已终止、端口已释放
- hills.json 校验器启动全量通过（10 山、间距全部 ≥15）

### 环境备注

- 本机 Node 位于 Kimi 内置运行时（`kimi-desktop/.../runtime/node.exe`，v24.15.0 + npm 11.12.1），Git Bash 中需用 `npm.cmd`；命令行已验证可用

### 偏差与遗留

- 点亮状态在 M1 只能通过 `?debug` 面板切换（点亮演出在 M2 的 LightingRitual 实现）
- 占位树为统一叶锥（1 种），M3 按 `env.decor` 替换主题装饰
- 待用户在浏览器手动过一遍 M1 验收清单（fps、悬停、进出、刷新保留、提示只出现一次、损坏存档备份）

### 下一步

- M1 浏览器验收 → 通过后进入 [M2 青竹林垂直切片](task/m2-vertical-slice.md)（老师 GLB 选型、对话系统、冥想会话、点亮演出）

---

## 2026-07-20 ｜ M1 地图原型 — 浏览器验收通过 ✅

- 用户按 [ops/preview.md](ops/preview.md) 第 6 节清单完成浏览器人工验收，10 条全部通过
- 已同步状态：[task/m1-map-prototype.md](task/m1-map-prototype.md) 标记完成、[task/task-overview.md](task/task-overview.md) 里程碑表更新、[project.md](project.md) 进度清单更新
- **下一步**：M2 青竹林垂直切片（[task/m2-vertical-slice.md](task/m2-vertical-slice.md) 任务 2.1~2.14）：老师 GLB 选型（A1）、对话系统、冥想会话（文字引导 + 计时）、点亮演出、WebAudio 占位音（A2）

---

## 2026-07-20 ｜ M2 青竹林垂直切片 — 编码完成，待浏览器人工验收

### 决策确认

开工前用户逐项确认 D1~D8（已写入 [task/m2-vertical-slice.md](task/m2-vertical-slice.md) §3）：Kenney 站立人形+程序化蒲团；装饰全程序化；引导词/剧本 AI 定稿并存档 `docs/material/`；day=缓慢环绕机位；HUD 常驻静音钮；renderer.info 基线为泄漏口径；一次性交付后统一验收。

### 完成内容

按任务 2.1~2.14 全部落地：

| 任务 | 产出 |
|---|---|
| 2.1 老师模型 | `public/assets/models/character-human.glb`（Kenney Mini Dungeon CC0，42KB）+ `LICENSE.md` 许可记录；官网 404 经镜像取得同一文件，已注明 |
| 2.2 TeacherRig | `src/scenes/meditation/TeacherRig.ts`：包围盒归一化至 1.7m、统一朝向、程序化蒲团遮挡下半身、失败回退胶囊+球头+斗笠、呼吸/随机点头、冥想中幅度减半、`teacher.color` 染色 |
| 2.3 场景模板 | `src/scenes/meditation/ThemeEnvironment.ts`：40m 顶点色地块、day 天穹、竹丛 56×2 与石灯笼 6×3 InstancedMesh、落叶 Points 300、共享 Lambert 材质、unlit/lit 双态接口，全部配置驱动 |
| 2.4 三段机位 | 入场 2.5s cubic-out 缓推（锁输入）→ 对话过肩 1.2s → 冥想 2°/s 环绕（D5） |
| 2.5 AssetLoader | `src/core/AssetLoader.ts`：飞行期去重、`loadMany` 并发 + `assets:progress`、失败 warn + 占位回退 |
| 2.6 对话系统 | `src/systems/DialogueSystem.ts` + `src/ui/DialogueBox.ts`：text/options/action 状态机、打字机 25 字/秒可补全、Space/Enter 前进 |
| 2.7 竹心剧本 | `src/data/dialogues/bamboo.json`：4 轮 + 1 组选项 + `start_meditation` 收尾（含 blessing）；md 存档 `docs/material/dialogue/bamboo.md` |
| 2.8 会话核心 | `src/core/Timeline.ts` + `src/systems/MeditationSession.ts`：performance.now() 差值计时、pause/resume/abort、visibilitychange 自动暂停 + `meditation:paused-auto`、cue 去重调度 |
| 2.9 冥想 HUD | `src/ui/MeditationHud.ts`：SVG 圆环、剩余 mm:ss、引导语淡入淡出、WAAPI 呼吸环（4s/4s）、隐藏界面、暂停遮罩 |
| 2.10 引导词 ×2 | 5 分钟 = GDD 附录 B 原文；10 分钟同结构拉长 12 条 cue（max t=592<600）；md 存档 `docs/material/guide-words/` |
| 2.11 占位音 | `src/systems/AudioSystem.ts`：三泛音钵音 1.5s 衰减 + 点击音、首次手势解锁、静音即时生效写存档、地图/场景双常驻静音钮（D6） |
| 2.12 点亮演出 | `src/systems/LightingRitual.ts`：钵音→光柱（加色 ShaderMaterial）→金粒 300→unlit→lit 插值→淡出，约 4s，全程吞输入，用完即 dispose |
| 2.13 收尾 UI | `src/ui/screens.ts`：时长面板（5/10/取消）、完成页（本次/累计/赠言/返回）、中断确认框 |
| 2.14 端到端 | main.ts/UIManager/index.html/style.css/validate.ts 接线；`?debug` ×1/×10/×60 计时加速、`?hill=bamboo` 直进；对话/引导校验（cue 升序、引用闭环） |

### 验证结果

- `npm run build`：tsc --noEmit 零错误，vite 打包成功（dist js 686KB / gzip 177KB）
- dev server 冒烟：首页、10 个 TS 模块、GLB 全部 HTTP 200，测试后进程已终止
- 验收文档已备：[test/m2-acceptance.md](test/m2-acceptance.md)（8 节人工验收清单）

### 偏差与遗留

- GLB 无独立头节点，点头以整体轻微俯仰代替；站立模型下半身没入蒲团 0.32m 视觉盘坐，观感待人工确认
- "隐藏界面"按钮全程可点（未按 GDD 加"10 秒后出现"限制，如需可一行改回）
- 内存基线（D7 往返 10 次）与音频可闻性需浏览器人工验收
- 其余 9 山 decor/particles key 暂 warn 跳过，留 M3

### 下一步

- 用户按 [test/m2-acceptance.md](test/m2-acceptance.md) 人工验收 → 通过后进入 M3 内容铺开（9 套主题配置 + 全部剧本/引导词）
