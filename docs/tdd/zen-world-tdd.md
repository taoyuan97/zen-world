# 禅境世界 Zen World — 技术设计文档（TDD）

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-07-19 |
| 关联文档 | [`docs/gdd/zen-world-gdd.md`](../gdd/zen-world-gdd.md) v0.1 |
| 技术栈 | Three.js + Vite + TypeScript（ strict 模式） |
| 平台 | 桌面浏览器（Chrome / Edge / Safari 最新版） |

> 本文档回答"怎么实现"。凡是 GDD 已定义的体验与内容（玩法、主题、文案规范），本文不重复，只引用其编号。文档中的接口定义为设计契约，实现时可微调命名，但职责划分不应偏离。

---

## 1. 技术目标与约束

1. **零后端**：纯静态站点，构建产物可直接部署任意静态托管。
2. **数据驱动**：10 座山全部差异（位置、配色、装饰、对话、引导脚本）来自 `src/data/`，代码零硬编码主题（GDD §7.3）。
3. **性能预算**（GDD §6）：单场景 < 50k 三角面、纹理 < 4MB、桌面中端 60fps；装饰物一律 `InstancedMesh`。
4. **依赖最小化**：运行时依赖仅 `three`；M4 增加 `howler`。不引入框架（React/Vue），UI 用原生 DOM。
5. **计时可靠性**：冥想计时基于 `performance.now()` 差值，标签页隐藏可暂停恢复（GDD §9 风险对策）。

---

## 2. 总体架构

### 2.1 分层视图

```
┌──────────────────────────────────────────────┐
│ UI 层（原生 DOM/CSS）                          │
│  开始页 · 地图HUD · 对话框 · 时长选择 ·          │
│  冥想HUD(计时/引导/呼吸环) · 完成页 · 过渡遮罩    │
├──────────────────────────────────────────────┤
│ 系统层（纯 TS，不直接操作 DOM 事件外的渲染）      │
│  DialogueSystem · MeditationSession(Timeline) │
│  LightingRitual · SaveSystem                  │
├──────────────────────────────────────────────┤
│ 场景层（Three.js）                             │
│  MapScene · MeditationScene                   │
├──────────────────────────────────────────────┤
│ 核心层                                        │
│  GameApp(渲染器/主循环) · SceneManager        │
│  AssetLoader · EventBus · Tween · validators  │
├──────────────────────────────────────────────┤
│ 数据层                                        │
│  hills.json · dialogues/*.json · meditations/* │
└──────────────────────────────────────────────┘
```

- **依赖方向自上而下**，场景层/系统层通过 `EventBus` 向 UI 层发消息，UI 层回调通过注入的命令接口（command handler）下行，禁止 UI 直接 `import` 场景内部对象。
- 场景层不读存档；点亮状态由 `SceneManager` 在 `enter()` 时作为参数注入。

### 2.2 关键数据流（一次完整闭环）

```
启动 → SaveSystem.load() → SceneManager.enter(MapScene, { save })
  → 用户点击山(id) → EventBus: "hill:selected"
  → TransitionOverlay 淡出 → enter(MeditationScene, { hillId, theme })
  → 机位动画 → 用户点击老师 → DialogueSystem.start(dialogueJson)
  → action=start_meditation → UI 时长选择 → MeditationSession.start(script)
  → Timeline 触发 cue → EventBus: "meditation:cue" → UI 显示引导语
  → 计时走完 → EventBus: "meditation:complete"
  → SaveSystem.markLit(hillId) → LightingRitual.play()
  → UI 完成页 → 返回 → enter(MapScene, { save 更新后 }) → 山体点亮
```

---

## 3. 工程脚手架

### 3.1 目录结构（对齐 GDD §7.2，细化为文件级）

```
zen-world/
├── index.html                 # 静态 UI 骨架（HUD/对话框等占位节点）
├── package.json
├── tsconfig.json              # strict, bundler moduleResolution
├── vite.config.ts             # base './'，assetsInlineLimit 调低
├── public/assets/
│   ├── models/                # .glb（老师、装饰件）
│   ├── audio/                 # M4
│   └── env/                   # 天空渐变贴图等（如需）
└── src/
    ├── main.ts                # 引导：GameApp 创建与启动
    ├── style.css              # 全局样式 + UI 浮层样式
    ├── core/
    │   ├── GameApp.ts
    │   ├── SceneManager.ts
    │   ├── AssetLoader.ts
    │   ├── EventBus.ts
    │   ├── Tween.ts
    │   ├── Timeline.ts
    │   └── validate.ts
    ├── scenes/
    │   ├── MapScene.ts
    │   ├── map/TerrainBuilder.ts
    │   ├── map/HillFactory.ts
    │   ├── MeditationScene.ts
    │   └── meditation/TeacherRig.ts
    ├── systems/
    │   ├── SaveSystem.ts
    │   ├── DialogueSystem.ts
    │   ├── MeditationSession.ts
    │   └── LightingRitual.ts
    ├── ui/
    │   ├── UIManager.ts       # 显隐调度唯一入口
    │   ├── DialogueBox.ts
    │   ├── MeditationHud.ts
    │   ├── Tooltip.ts
    │   └── screens.ts         # 开始页/时长选择/完成页
    ├── data/
    │   ├── hills.json
    │   ├── dialogues/*.json
    │   ├── meditations/*.json
    │   └── types.ts           # 数据格式 TS 类型（见附录 A）
    └── shaders/               # 如需自定义材质（光柱/粒子）
```

### 3.2 package.json 关键配置

```jsonc
{
  "name": "zen-world",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",              // 原生转发 --host/--port 参数
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.16x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^5.x",
    "@types/three": "^0.16x"
  }
}
```

- `npm run dev` 即开发预览（Vite 默认 5173，支持 `--port` 覆盖）。
- `vite.config.ts` 设 `base: './'`，保证构建产物可在任意子路径打开。

---

## 4. 核心层设计

### 4.1 GameApp（渲染器与主循环）

职责：创建并持有全局唯一的 `WebGLRenderer`、主时钟、主循环、窗口 resize 分发。

```ts
class GameApp {
  readonly renderer: THREE.WebGLRenderer;
  private scenes: SceneManager;
  start(): void;                 // renderer.setAnimationLoop
  private tick(time: number): void;
}
```

- 渲染器配置：`antialias: true`、`outputColorSpace = SRGBColorSpace`、`setPixelRatio(Math.min(devicePixelRatio, 2))`、阴影关闭（低模风格用烘焙色与雾，M4 再评估）。
- 主循环：`dt = clamp(now - last, 0, 100ms)`，转发 `scenes.update(dt)`；同帧只更新激活场景。
- 后台标签页：浏览器自动暂停 rAF；恢复时因 dt 钳制不会跳帧。**冥想计时不依赖此循环**（见 §6.3）。

### 4.2 SceneManager

```ts
type SceneId = 'map' | 'meditation';

interface IScene {
  readonly id: SceneId;
  enter(params?: SceneParams): Promise<void>;
  exit(): void;
  update(dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

class SceneManager {
  constructor(app: GameApp, overlay: TransitionOverlay, bus: EventBus);
  register(scene: IScene): void;
  async go(id: SceneId, params?: SceneParams): Promise<void>; // 唯一切换入口
  update(dt: number): void;
}
```

- `go()` 流程：`overlay.fadeOut() → current.exit() → current.dispose() → next.enter(params) → overlay.fadeIn()`。切换期间 `isTransitioning=true`，吞掉输入事件。
- 每个场景持有自己的 `THREE.Scene` 与 `THREE.Camera`；GameApp 渲染时取激活场景的 `(scene, camera)`。

### 4.3 EventBus

极小实现（约 40 行），字符串事件名 + 类型映射表，支持 `on/off/emit`。事件清单见附录 B。禁止跨层直接引用，一律走总线。

### 4.4 AssetLoader

- 包装 `GLTFLoader` / `TextureLoader`；`load(url)` 返回 Promise，内部 Map 缓存防重复请求。
- 冥想场景进入时按 `hills.json` 的 `env.decor` 清单并发加载，配加载进度事件（`assets:progress`）。
- 加载失败：退回程序化占位几何（同色盒体），不阻断流程，console.warn 记录。

### 4.5 Tween / Timeline

- `Tween`：数值/Vector3/Color 补间，`ease` 支持 quad/cubic/sine，`update(dt)` 由宿主驱动。相机动画、点亮渐变都基于它。
- `Timeline`：注册 `{ t: 秒, fn }` 序列，**用 `performance.now()` 差值**驱动；支持 `pause/resume/seek/stop`、到期回调去重触发。冥想 cue 调度唯一实现。

### 4.6 validate.ts

- 针对三类数据（hills / dialogue / meditation）的手写校验函数：必填字段、类型、引用完整性（`dialogue` 指向的文件存在、meditation 的 `duration` 与最大 cue `t` 匹配）。
- 启动时全量校验一次，失败在开发模式抛错、生产模式 console.error + 跳过该山。不引入 zod，保持依赖最小。

---

## 5. 场景层设计

### 5.1 MapScene

**构成**：`TerrainBuilder`（地形）、`HillFactory`（10 座山）、灯光组、水面/云海面片、装饰（雾、远景山剪影）。

**地形生成（TerrainBuilder）**

- `PlaneGeometry(200, 200, 96, 96)` + 简单噪声（自带 20 行 value-noise，不引库）位移高度；`flatShading: true`。
- 顶点色按高度分带：水面线以下蓝灰、低海拔苔绿、高海拔岩灰；点亮状态不改地形，只改山与灯。
- 10 个山位由 `hills.json.mapPosition` 指定，地形生成时在山位处压低平台（保证山体嵌入自然）。

**山体（HillFactory）**

- 每座山 = 圆锥/不规则低模山体 `Mesh` + 装饰子组（树、灯笼、小屋，来自主题 `env.decor`）+ 顶部 `PointLight`（暖色，默认 `visible=false`）+ 灯笼材质（点亮时 `emissiveIntensity` 0→1）。
- 点亮着色：山体材质克隆两份系数——`unlit` 降饱和 40% + 加雾密度感知色；切换用 Tween 在 1.2s 内插值顶点色/雾/灯光强度。
- 山体 `userData.hillId`，供拾取。

**相机与拾取**

- `OrbitControls`：`enableDamping`、`minPolarAngle=20°`、`maxPolarAngle=60°`、`minDistance=30`、`maxDistance=90`、`enablePan=false`；空闲 5s 后 `autoRotate=true`（速度 0.3），任意输入即停。
- 拾取：`pointermove` 节流（每帧一次）Raycast 山体列表 → 命中则 `emissive` 提亮 + `Tooltip` 显示山名（世界坐标投影到屏幕坐标，HUD 定位）；`click` 命中且非拖拽（按下/抬起位移 < 5px）→ `bus.emit('hill:selected', hillId)`。
- 已点亮/未点亮都可进入；`lighting` 状态的山在地图上不存在（该状态只发生在冥想场景内演出时）。

**HUD 数据**：`enter({ save })` 时按存档渲染 10 座山状态，并 emit `ui:progress`（x/10）。

### 5.2 MeditationScene

**模板结构**（所有主题共用代码，配置驱动视觉）：

```
MeditationScene
├── themeGround      // 直径约 40m 圆形地块，顶点色按 palette
├── decorGroup       // 按 env.decor 清单实例化（InstancedMesh）
├── skyDome          // 大反转球体，顶点色渐变（day/night/sunset 预设 × 主题色）
├── teacher          // TeacherRig（低模人形 + 程序化待机）
├── seat             // 蒲团/岩石
├── particles        // 主题粒子（落叶/萤火/雪），Points + 自定义 update
└── cameraRig        // 三段机位关键帧
```

**入场流程**

1. `enter({ hillId })` → 查 `hills.json` → `AssetLoader` 并发加载 → 应用主题（雾色、天空、配色、装饰）。
2. 机位 1（入场）：相机从远景 2.5s 缓推至对话位（Tween cubic-out），期间禁输入。
3. 待机：可点击老师（Raycast + 悬停提示"与老师交谈"）。
4. 对话中：切机位 2（过肩中景）；`DialogueSystem` 接管 UI。
5. 冥想中：切机位 3（缓慢环绕，角速度 2°/s，或固定远景——按 `env.sky` 预设）。
6. 完成：`LightingRitual` → 完成页 → `SceneManager.go('map')`。

**TeacherRig（MVP）**

- 低模人形：CC0 GLB 成品模型（2026-07-19 已确认 A1），经 AssetLoader 归一化（包围盒缩放到目标高度、统一朝向）；加载失败时回退程序化拼装（胶囊身体 + 球头 + 斗笠/披风件）。
- 程序化待机：身体 `scale.y = 1 + 0.015·sin(t·1.2)`（呼吸）；头部每 6~9s 随机点头一次（Tween）；冥想中动作幅度减半。
- 配色：`teacher.color` 应用为主衣色；手持物按 `teacher.prop` 挂接。

---

## 6. 系统层设计

### 6.1 SaveSystem

```ts
class SaveSystem {
  load(): SaveData;                    // 缺省/损坏时返回初始档并备份原值
  markLit(hillId: string, sessionSeconds: number): void;
  addSession(hillId: string, sessionSeconds: number): void; // 重复冥想
  setMuted(muted: boolean): void;
  readonly data: SaveData;
}
```

- localStorage 键 `zen-world-save-v1`（schema 见 GDD 附录 C，TS 类型见本文附录 A）。
- 写入防抖 300ms；`version` 字段预留迁移（`migrate(raw)` 钩子，当前 v1 直通）。
- 损坏容错：`JSON.parse` 失败 → 原字符串转存 `zen-world-save-v1.bak`，重置新档。

### 6.2 DialogueSystem

```ts
class DialogueSystem {
  start(script: DialogueScript): void;   // 走状态机，驱动 DialogueBox UI
  advance(): void;                       // 点击/空格
  choose(index: number): void;           // 选项
  onAction?: (action: string) => void;   // 'start_meditation'
  stop(): void;
}
```

- 节点状态机：`text` 节点 → 打字机（20~30 字/秒，可点击立即补全）→ 等待 `advance`；`options` 节点 → 渲染选项按钮，`choose` 跳 `reply`；`action` 字段触发 `onAction` 并结束对话。
- 与场景解耦：系统只依赖 JSON 与 UI 接口；场景负责在适当时机 `start()`。

### 6.3 MeditationSession

```ts
class MeditationSession {
  start(script: MeditationScript, opts: { onComplete: () => void }): void;
  pause(): void;    // 页面隐藏/用户暂停
  resume(): void;
  abort(): void;    // 中途退出（不计完成）
}
```

- **计时**：`startAt = performance.now()`，每次 tick 用差值；`pause` 记录偏移；杜绝 dt 累加误差。
- **页面可见性**：`visibilitychange → hidden` 自动 `pause()` 并 emit `meditation:paused-auto`；UI 提示"已为你暂停"。
- **cue 调度**：内部 `Timeline`，到点 emit `meditation:cue { text }`；呼吸环节奏由 `breathCycle` 下发 UI（CSS 动画实现，不占用 3D 循环）。
- **完成**：最后一条 cue 播完且 elapsed ≥ duration → `onComplete()`（随后由调用方触发存档与点亮演出）。
- **退出确认**：Esc/返回 → emit `meditation:abort-request` → UI 确认框 → `abort()`。

### 6.4 LightingRitual

```ts
class LightingRitual {
  async play(scene: MeditationScene, theme: HillConfig): Promise<void>;
}
```

演出序列（约 4s，全部 Tween 串联）：

1. t=0.0s 钵音（M4 前 WebAudio 振荡器合成 1.5s 衰减音）；
2. t=0.2s 老师身后光柱升起（圆柱 + 加色渐变 ShaderMaterial，透明度 0→0.6）；
3. t=0.8s 金色粒子环扩散（Points，300 粒子，1.5s 生命周期）；
4. t=0.8~3.0s 场景整体配色插值：雾色/天空/地面从 unlit → lit 主题色；
5. t=3.0s 光柱淡出 → resolve → UI 完成页。

---

## 7. UI 层设计

- **唯一入口 `UIManager`**：持有全部浮层节点引用，提供 `show(screen)` / `hide(screen)`；任何模块不直接操作 DOM 显隐。
- **DOM 结构**：`index.html` 内置静态骨架（`<div id="app">` 画布容器 + `<div id="ui">` 各浮层），TS 只做填充与事件绑定；浮层默认 `pointer-events: none`，可交互子元素单独开启。
- **组件**：
  - `DialogueBox`：打字机、名字牌、选项按钮；键盘 Space/Enter 前进。
  - `MeditationHud`：SVG 圆环进度（`stroke-dashoffset` 驱动）、剩余时间、引导语区（淡入淡出）、呼吸圆环（CSS keyframes，周期由 `breathCycle` 内联变量控制）、"隐藏界面"按钮。
  - `Tooltip`：山名浮签，跟随投影坐标。
  - `screens.ts`：开始页、时长选择（5/10 分钟）、完成页（本次时长/累计/赠言）、退出确认框、过渡遮罩。
- **视觉规范**（GDD §5.6）：Noto Serif SC、半透明深色底 `rgba(20,24,28,.72)`、圆角 12px、细边框 1px `rgba(255,255,255,.14)`；全部动画 ≤ 300ms ease-out。
- **通信**：UI → 系统/场景走注入的回调（构造时传入）；系统/场景 → UI 走 EventBus（附录 B）。

## 8. 数据格式与校验

- 三类 JSON 的 TS 类型见附录 A（与 GDD 附录 A/B/D 的示例一一对应）。
- `hills.json` 启动时全量加载并校验：10 项、id 唯一、`mapPosition` 两两水平距离 ≥ 15（防遮挡）、引用文件齐全。
- 对话/引导脚本按需加载（进场景时），校验失败 → 该山回退为"维护中"提示，不崩溃。

## 9. 性能方案

| 项 | 方案 |
|---|---|
| 装饰物 | 同种装饰 `InstancedMesh`（竹、树、石）；单场景 draw call 目标 < 80 |
| 材质 | 共享 `MeshLambertMaterial`（顶点色）；禁止每 Mesh 新建同参材质 |
| 粒子 | `THREE.Points` + 循环更新 attribute；上限 500/场景 |
| 纹理 | 尽量顶点色；必需纹理 ≤ 1024²，总量 < 4MB |
| 释放 | 场景 `dispose()` 遍历 `geometry.dispose()` / `material.dispose()`；AssetLoader 缓存随场景组卸载 |
| 测量 | 开发模式 `?debug` 显示 fps/draw calls（renderer.info） |

## 10. 构建、预览与调试

- 开发：`npm run dev`（Vite 转发 `--host`/`--port`）。
- 构建：`npm run build`（先 `tsc --noEmit` 类型检查，产物 `dist/`）。
- 调试开关：`?debug`（性能面板 + 点亮状态调试按钮）、`?hill=<id>`（跳过地图直进场景，M2 起）。
- 目标浏览器：ES2020+，WebGL2（Three r160+ 默认；WebGL1 降级不保证）。

## 11. 里程碑技术任务映射

| 里程碑 | 技术任务（完成定义） |
|---|---|
| M1 地图原型 | §3 脚手架、§4.1~4.5 核心层、`TerrainBuilder`/`HillFactory`、OrbitControls、拾取+Tooltip、SaveSystem 读写、亮/暗双态渲染、`ui:progress` |
| M2 单场景闭环 | MeditationScene 模板 + 青竹林主题、TeacherRig、三段机位、DialogueSystem、MeditationSession+Timeline、MeditationHud、LightingRitual、完成页、中断确认 |
| M3 内容铺开 | 9 套主题配置 + 装饰实例化、全部 JSON 剧本/引导词、校验器完备、重复冥想累计 |
| M4 打磨 | AudioManager（Howler）+ TTS cue 同步、10/10 全局演出、粒子增强、移动端触摸评估、性能优化（✅ 2026-07-20 完成） |

## 12. 技术风险与对策

| 风险 | 对策 |
|---|---|
| 标签页后台导致 rAF 暂停、计时漂移 | 冥想计时 `performance.now()` 差值 + 可见性暂停（§6.3） |
| 顶点色双态切换成本高 | 预生成两套顶点色数组，Tween 只做混合系数；量小（<50k 顶点）无压力 |
| CC0 素材风格/尺寸不一 | AssetLoader 统一归一化（包围盒缩放到目标高度）；缺失件程序化占位（§4.4） |
| iOS Safari 音频需手势解锁（M4） | 首次点击"开始"时 `AudioContext.resume()` |
| 低模人形违和 | 统一轮廓 + 统一调色板；M4 再评估 Mixamo 替换，TeacherRig 接口保持兼容 |

---

## 附录 A — 核心 TypeScript 类型（src/data/types.ts）

```ts
// —— 山配置 ——
interface HillConfig {
  id: string;
  name: string;
  mapPosition: [number, number, number];
  palette: { primary: string; accent1: string; accent2: string };
  env: {
    fog: string;
    sky: 'day' | 'night' | 'sunset';
    decor: string[];          // 装饰件 key 清单
    particles: 'leaves' | 'fireflies' | 'snow' | 'petals' | 'none';
  };
  teacher: { name: string; color: string; prop: string };
  dialogue: string;           // 相对 data/ 路径
  meditations: { '5': string; '10': string };
}

// —— 对话 ——
interface DialogueNode {
  id: string;
  text: string;
  next?: string;
  options?: { label: string; reply: string }[];
  action?: string;            // 如 'start_meditation'
}
interface DialogueScript {
  hillId: string;
  teacher: string;
  nodes: DialogueNode[];      // 首个节点为入口
}

// —— 冥想引导 ——
interface MeditationCue { t: number; text: string }
interface MeditationScript {
  hillId: string;
  duration: number;           // 秒
  breathCycle: { inhale: number; exhale: number };
  cues: MeditationCue[];      // 按 t 升序，最后一条 t < duration
}

// —— 存档 ——
interface HillSave {
  lit: boolean;
  firstLitAt?: string;        // ISO 时间
  sessions: number;
  totalSeconds: number;
}
interface SaveData {
  version: 1;
  hills: Record<string, HillSave>;
  stats: { totalSessions: number; totalSeconds: number };
  settings: { muted: boolean };
}
```

## 附录 B — EventBus 事件清单

| 事件 | 载荷 | 方向 | 说明 |
|---|---|---|---|
| `hill:selected` | `{ hillId }` | 场景→App | 地图点击山 |
| `assets:progress` | `{ loaded, total }` | 核心→UI | 场景加载进度 |
| `ui:progress` | `{ lit, total }` | 场景→UI | 点亮进度刷新 |
| `dialogue:action` | `{ action }` | 系统→场景 | 对话触发动作 |
| `meditation:cue` | `{ text }` | 系统→UI | 引导语更新 |
| `meditation:paused-auto` | `{}` | 系统→UI | 页面隐藏自动暂停 |
| `meditation:abort-request` | `{}` | UI→系统 | 请求中断确认 |
| `meditation:complete` | `{ hillId, seconds }` | 系统→App | 冥想完成 |
| `ritual:done` | `{ hillId }` | 系统→App | 点亮演出结束 |
| `settings:muted` | `{ muted }` | UI→系统 | 静音开关 |

---

*文档结束。v0.1（2026-07-19）初版：与 GDD v0.1 对齐，作为 M1~M2 实现依据。*
