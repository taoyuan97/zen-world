# M3 十山遍历测试记录（任务 3.7）

| 项目 | 内容 |
|---|---|
| 日期 | 2026-07-20 |
| 方式 | 自动校验 + 静态覆盖核对 + 构建/冒烟；浏览器动态遍历见 [m3-acceptance.md](m3-acceptance.md)（人工） |

---

## 1. 全量数据校验（校验器，30/30 通过）

生产校验器（`src/core/validate.ts`）离线编译后对全部内容文件实跑：

- `hills.json`：10 山、id 唯一、间距 ≥ 15、palette/sky/粒子枚举全部合法 ✓
- `dialogues/*.json` ×10：hillId 匹配、节点引用闭环、入口/选项/action 合法 ✓
- `meditations/*.json` ×20：cue 严格升序、最大 t < duration（5min 300s / 10min 600s 复核）✓
- 呼吸节奏复核（M3-D4）：温泉谷 5s/5s，其余 9 山 4s/4s ✓

结果：`30/30 通过，0 失败`（对话 10 + 引导词 20）。

## 2. 十山配置覆盖遍历（静态核对，0 未覆盖项）

对每山核对：decor key 全部在 `ThemeEnvironment` 注册表有实现、粒子类型有差异化实现、`teacher.prop` 在 `TeacherRig` 有实现、对话/引导文件齐全：

| 山 | sky | 雾距 | decor | 粒子 | prop | 对话节点 | 5min cue | 10min cue | 呼吸 |
|---|---|---|---|---|---|---|---|---|---|
| bamboo | day | 默认 | bamboo+stone_lantern | leaves | bamboo_staff | 5 | 8 (max 295) | 12 (max 592) | 4/4 |
| snowpeak | day | 默认 | pine+rock | snow | prayer_beads | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| lakeside | day | 默认 | reed+stone_lantern+water_glint | fireflies | tea_bowl | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| starfield | night | 默认 | rock+crystal（+星空/流星） | fireflies | star_chart | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| desert | sunset | 默认 | dry_tree+rock+dune | none | wooden_fish | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| sakura | day | 默认 | sakura_tree+stone_lantern | petals | paper_umbrella | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| mistvalley | day | 9/46 | pine+rock | none | walking_stick | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| grassland | day | 默认 | grass_tuft+rock | leaves | reed_flute | 5 | 8 (max 292) | 12 (max 592) | 4/4 |
| hotspring | sunset | 默认 | rock+steam_vent | steam | wooden_ladle | 5 | 8 (max 292) | 12 (max 592) | 5/5 |
| temple | sunset | 默认 | pagoda+banner | fireflies | temple_bell | 5 | 8 (max 292) | 12 (max 592) | 4/4 |

## 3. 构建与冒烟

- `npm run build`：tsc --noEmit 零错误，vite 打包成功（dist js ~720KB / gzip 186KB）
- 产物抽查：bundle 含全部新 decor/prop key 与新文案数据（import.meta.glob 已打包新 JSON）
- dev server 冒烟：首页、`main.ts`、`ThemeEnvironment.ts`、`TeacherRig.ts`、`MeditationScene.ts`、老师 GLB、`?hill=starfield&debug=1` 深链全部 HTTP 200，测试后进程已终止

## 4. 待人工完成部分

- 每山浏览器动态走一遍闭环（`?hill=<id>` 直进 + `?debug` 加速）→ 按 [m3-acceptance.md](m3-acceptance.md) 逐项打勾
- 视觉差异（配色/装饰/天空时段/粒子）与性能（60fps、draw calls < 80）实测
- 文案集中校对（任务 3.8，用户验收环节）
