# M2 — 垂直切片：青竹林闭环（任务文档）

| 项目 | 内容 |
|---|---|
| 里程碑目标 | 青竹林主题完整闭环：进山 → 运镜 → 老师 → 对话 → 5/10 分钟冥想（文字引导 + 计时）→ 点亮演出 → 返回地图山变亮 |
| 状态 | ✅ 已完成（2026-07-20 编码完成；遗留阻塞缺陷 [ISSUE-M2-001](../issue/m2-meditation-completion-hang.md)：计时结束卡住，待修复后回归验收） |
| 技术依据 | TDD §4.4（AssetLoader）、§4.5（Tween/Timeline）、§5.2（MeditationScene/TeacherRig）、§6.2~6.4（对话/会话/演出）、§7（UI 层） |
| 入口条件 | M1 验收通过 |
| 预估 | ~11 人日 |

---

## 1. 任务清单

| # | 任务 | 产出 | 预估 | 依赖 |
|---|---|---|---|---|
| 2.1 | **老师模型选型（A1）**：从 Quaternius/Kenney 选 1~2 个 CC0 低模人物 GLB，下载入 `public/assets/models/`，记录许可；AssetLoader 归一化（包围盒缩放至目标高度、统一朝向、盘坐姿态处理或配蒲团） | 可用老师模型 + 许可记录 | 1d | M1 |
| 2.2 | TeacherRig：GLB 加载 + 程序化待机叠加（呼吸 scale、随机点头 Tween、冥想中幅度减半）；配色按 `teacher.color` 应用 | 老师装配模块 | 1d | 2.1 |
| 2.3 | MeditationScene 模板：themeGround（直径 40m）、skyDome（day 预设）、decorGroup（竹林 InstancedMesh）、落叶粒子（Points ≤ 500）、雾/配色应用 | 青竹林场景骨架 | 1.5d | M1, 2.1 |
| 2.4 | 三段机位：入场 2.5s 缓推 → 对话过肩位 → 冥想慢环绕（2°/s）；Tween cubic-out | 相机系统 | 0.5d | 2.3 |
| 2.5 | AssetLoader 完善：并发加载、`assets:progress` 事件、失败回退程序化占位 | 加载管线 | 0.5d | M1 |
| 2.6 | DialogueSystem 状态机 + DialogueBox UI：打字机（20~30 字/秒、点击补全）、选项按钮、Space/Enter 前进、`action` 回调 | 对话系统 | 1d | M1 |
| 2.7 | **青竹林对话剧本**（A3）：2~4 轮 + 1 组选项 + `start_meditation` 收尾，竹心口吻 | `dialogues/bamboo.json` | 0.5d | 2.6 |
| 2.8 | Timeline + MeditationSession：`performance.now()` 差值计时、pause/resume/abort、`visibilitychange` 自动暂停、cue 调度 | 会话核心 | 1d | M1 |
| 2.9 | MeditationHud（A5）：SVG 圆环 + 剩余分钟数、引导语淡入淡出、CSS 呼吸环（4s/4s）、"隐藏界面"按钮、Esc/返回中断确认框 | 冥想 HUD | 1d | 2.8 |
| 2.10 | **青竹林引导词 ×2**（A3）：5 分钟版（GDD 附录 B 已定稿）+ 10 分钟版（同结构拉长） | `meditations/bamboo.{5,10}min.json` | 0.5d | 2.8 |
| 2.11 | **WebAudio 占位音（A2）**：钵音（振荡器 1.5s 衰减）、UI 点击音；首次手势解锁 AudioContext；接入静音开关 | 占位音频 | 0.5d | 2.9 |
| 2.12 | LightingRitual：钵音 → 光柱（加色 ShaderMaterial）→ 金粒扩散 → 场景配色 unlit→lit 插值 → 光柱淡出，约 4s | 点亮演出 | 1d | 2.3, 2.11 |
| 2.13 | 时长选择面板（5/10 分钟）+ 完成页（本次时长/累计次数与时长/竹心赠言/返回地图） | 会话收尾 UI | 0.5d | 2.8, 2.12 |
| 2.14 | 端到端联调 + M2 验收 | 闭环确认 | 0.5d | 全部 |

## 2. 验收标准

- [ ] 完整走通：地图点青竹林 → 入场运镜 → 点老师 → 对话（含选项分支）→ 选 5 分钟 → 引导语按 cue 出现、呼吸环节奏正确 → 计时结束 → 演出 → 完成页 → 返回地图山已点亮
- [ ] 10 分钟档同样走通（可开 `?debug` 加速计时验证，加速仅限调试模式）
- [ ] 冥想中切换标签页：自动暂停并提示；回来后手动恢复，剩余时间准确（误差 < 2s）
- [ ] Esc/返回 → 确认框 → 确认退出：本次不计完成，回地图山仍为未点亮
- [ ] 已点亮后再次进入：可重复冥想，完成页累计次数/时长正确增加
- [ ] 钵音与点击音可闻，静音开关即时生效，刷新后静音状态保留
- [ ] 演出期间输入被吞掉；场景 dispose 后无 WebGL 内存泄漏（`?debug` 观察）
- [ ] `npm run build` 通过

## 3. 已确认决策（2026-07-20 用户确认）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 老师模型选型（A1） | Kenney CC0 站立人形 GLB，配程序化蒲团/岩石座遮挡下半身，不做骨骼重定向 |
| D2 | 装饰件（竹子、石灯笼） | 全部程序化生成，保持低模风格统一，零许可风险；老师 GLB 为唯一外部素材 |
| D3 | 引导词 | 5 分钟版用 GDD 附录 B 定稿；10 分钟版按同结构拉长，以 AI 撰写为定稿；两版文案同时存档 `docs/material/guide-words/`（md 格式） |
| D4 | 竹心对话剧本 | 按"2~4 轮 + 1 组选项 + start_meditation 收尾"直接撰写定稿，参考 GDD 文案规范；同时存档 `docs/material/dialogue/`（md 格式） |
| D5 | 机位 3（冥想中） | day 预设 = 缓慢环绕 2°/s |
| D6 | 占位音与静音 | 钵音合成函数复用于任务 2.11 与 LightingRitual t=0；HUD 加常驻静音按钮，状态写存档、刷新保留 |
| D7 | 内存泄漏验收口径 | `?debug` 面板观察 `renderer.info`，地图↔场景往返 10 次后 geometries/textures 回到基线 |
| D8 | 执行方式 | 14 个任务按依赖序一次实现完毕并自测 `npm run build`，全部完成后一次性验收；验收参考 `docs/test/m2-acceptance.md` |

## 4. 风险与备注

- 老师 GLB 若姿态不合（非盘坐），优先配蒲团/岩石遮挡下半身，不做骨骼重定向。
- 占位音只追求"不刺耳"，音色打磨是 M4 的事。
- 对话/引导 JSON 必须过校验器：cue 升序、最大 `t` < `duration`、节点引用闭环。
