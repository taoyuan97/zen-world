# ISSUE-M2-001 ｜ 5 分钟计时结束后页面卡住，未进入点亮演出

| 项目 | 内容 |
|---|---|
| 状态 | 🔍 待修复（修复方案待用户确认） |
| 发现日期 | 2026-07-20（M2 人工验收） |
| 严重度 | 阻断级：主闭环在完成点中断，无法点亮、无法完成存档 |
| 里程碑 | M2 青竹林垂直切片 |

---

## 1. 现象

5 分钟冥想计时走到 `0:00` 后，页面停在该状态：HUD（圆环 + `0:00` + 最后一条引导语"准备好了，就慢慢睁开眼睛。" + 呼吸环）保持显示，点亮演出（LightingRitual）未触发，完成页未出现。（见验收截图）

## 2. 排查过程

### 2.1 已走查的代码路径（均未发现必然断点）

完成链路：`MeditationSession.tick`（250ms setInterval）→ `elapsed >= duration` → `teardown()` → `emit('meditation:complete')`（无监听者）→ `onComplete` → `MeditationScene.onSessionComplete` → `hideMeditationHud()` → `save.markLit()` → `await LightingRitual.play()`（Tween 由场景 update 驱动）→ `ui:progress` / `ritual:done` → 完成页。

逐段走查结论：

- `MeditationSession` / `Timeline`：计时用 `performance.now()` 差值，暂停/恢复/缩放锚点结算正确；`tick` 中进度事件与完成判定使用**同一个 `elapsed` 变量**。
- HUD `updateProgress`：`remaining = Math.max(0, Math.ceil(duration - elapsed))`，显示 `0:00` 当且仅当 `elapsed >= duration`——与完成判定条件完全等价。
- `onSessionComplete` 前置守卫 `state === 'meditation'`：冥想期间无任何路径改变 state（Esc 只发确认请求；自动暂停不改 state）。
- `hideMeditationHud` → `meditationHud.hide()` → 加全局 `.hidden` 类（style.css:48 已确认存在）。
- `LightingRitual.play`：Tween 链完整，3.9s 后 resolve；`AudioSystem.playBowl` 无可见抛错点。
- `GameApp.tick` / `EventBus.emit`：**均无 try/catch**——任何监听者/回调抛错都会沿调用栈上抛。

### 2.2 关键矛盾

截图中 HUD 显示 `0:00` 且**仍然可见**。按代码逻辑：

- `0:00` ⟺ `elapsed >= duration` ⟺ 同一 `tick` 内完成判定必然成立；
- 完成判定成立后第 3 步就是 `hideMeditationHud()`，HUD 必然消失。

两者不可能同时成立 ⟹ **完成链路在某个点被运行时异常打断**（异常中断了 interval 回调或 async 函数的同步段），且打断点位于"进度事件已发出 0:00"与"HUD 隐藏"之间的极窄区间，或 `onSessionComplete` 同步段内（hide 生效前抛错会使 Promise reject，成为 unhandledrejection）。

### 2.3 复现尝试（未完成）

已准备自动化复现脚本（dev server + WebBridge 驱动：直进 `?hill=bamboo&debug` → 点老师 → 对话 → 选 5 分钟 → ×60 加速 → 抓取 `error` / `unhandledrejection`），但执行时用户浏览器扩展未连接（WebBridge 返回 `no extension connected`），未能捕获现场。

## 3. 根因假设（按可能性排序）

| # | 假设 | 机制 | 验证方式 |
|---|---|---|---|
| H1 | 完成链路中某回调抛出未捕获异常 | EventBus.emit 与 GameApp.tick 无 try/catch；一个异常即可中断完成链或杀死当帧渲染循环 | 复现抓 console（error / unhandledrejection） |
| H2 | 渲染主循环在冥想期间已被异常杀死 | rAF 每帧抛错 → Tween 不推进 → 即使完成判定触发、ritual 也开始，`await ritual.play()` 永不 resolve（Tween 不走），页面呈"卡住" | 复现时观察画面是否仍在环绕（机位 3）/ console 每帧报错 |
| H3 | 特定环境状态（标签页可见性/音频上下文）与时序叠加 | visibilitychange 与 250ms tick 的竞态窗口极小，但不能完全排除 | 复现时切换标签页边界条件测试 |

> 注：H2 无法单独解释"HUD 未隐藏"，需与 H1 组合（hide 之前已抛错）。确切根因以浏览器复现的 console 输出为准。

## 4. 修复方案（防御性，覆盖全部假设）

| # | 修复点 | 内容 |
|---|---|---|
| F1 | `EventBus.emit` | 每个 handler 包 try/catch，异常 `console.error` 后继续派发，杜绝单个监听者炸掉整条事件链 |
| F2 | `GameApp.tick` | 包 try/catch：单帧异常 console.error 并继续下一帧，渲染循环不死 |
| F3 | `MeditationSession.tick` | 包 try/catch + 完成路径打日志（`[MeditationSession] complete @elapsed`），完成后无论下游如何都不再重复触发 |
| F4 | `MeditationScene.onSessionComplete` | `ritual.play()` 加 try/catch + 超时兜底（如 8s 未 resolve 则强制进入完成页），保证存档与完成页可达 |
| F5 | `LightingRitual.play` | Promise 内部异常兜底 resolve，演出对象清理（cleanup）放 finally 语义 |
| F6 | 复现后按确切根因补针对性修复 | 若 console 指向具体抛错点（如某 Three 对象 dispose 后复用），单独修 |

F1~F5 是相互独立的健壮性加固，建议全部实施；F6 依赖浏览器复现结果。

## 5. 验收回归

修复后按 `docs/test/m2-acceptance.md` 重走：§1 主闭环（重点步骤 10~12）、§3 中断恢复、§6 稳定性（往返 10 次内存基线）。

---

## 处理记录

| 日期 | 动作 | 说明 |
|---|---|---|
| 2026-07-20 | 记录 | 静态排查完成，修复方案 F1~F6 待用户确认；浏览器复现待扩展连接后执行 |
