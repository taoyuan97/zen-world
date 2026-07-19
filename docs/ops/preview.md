# 禅境世界 Zen World — 本地预览与验收流程

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-07-19 |
| 适用范围 | 开发期本地预览、里程碑浏览器验收 |
| 项目根目录 | `C:\projects\games\zen-world` |

---

## 1. 环境准备（一次性）

本项目需要 Node.js + npm。本机当前**未安装独立 Node**，使用 Kimi 内置运行时（已验证可用）：

- 路径：`C:\Users\18520\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\`
- 版本：node v24.15.0 / npm 11.12.1
- Git Bash 注意：该目录下只有 `npm.cmd`，直接敲 `npm` 找不到，需使用 `npm.cmd`；每次新开终端需先执行：

```bash
export PATH="/c/Users/18520/AppData/Local/Programs/kimi-desktop/resources/resources/runtime:$PATH"
```

- PowerShell 注意：`npm.cmd` 不在系统 PATH，每次新开窗口需先执行（注意命令中的引号必须成对闭合）：

```powershell
$env:Path = "C:\Users\18520\AppData\Local\Programs\kimi-desktop\resources\resources\runtime;$env:Path"
```

> 若日后安装了独立 Node.js（≥ 20），可跳过以上，直接使用 `npm`。
> 依赖已安装（node_modules 已存在）；克隆/重装环境时在项目根目录执行一次 `npm install`（或 `npm.cmd install`）。

## 2. 启动预览

**最简单的方式**：在 Kimi 对话中点击预览卡片链接（`http://localhost:7100/`），由 Kimi Work 自动启动并管理 dev server，无需手动执行任何命令。

**手动启动**（需要固定端口或脱离 Kimi 调试时）：

```bash
cd "C:\projects\games\zen-world"
npm.cmd run dev                 # 默认 http://localhost:5173
npm.cmd run dev -- --port 7100  # 需要指定端口时（-- 后的参数原样转发给 Vite）
```

- 浏览器打开终端中显示的地址即可；代码保存后页面热更新，无需重启。
- **停止服务**：在运行 dev server 的终端按 `Ctrl + C`。请勿让 dev server 常驻后台。

## 3. 预览中的调试开关

| 开关 | 用法 | 说明 |
|---|---|---|
| `?debug` | `http://localhost:5173/?debug` | 左上角调试面板：fps / draw calls / 三角面数 + 每座山点亮状态切换按钮（M1 阶段点亮的唯一触发方式） |
| `?hill=<id>` | （M2 起）`?hill=bamboo` | 跳过地图直进指定冥想场景，用于内容调试 |

## 4. 构建验证

```bash
npm.cmd run build   # 先 tsc --noEmit 类型检查，再打包到 dist/
```

提交或验收前执行一次，必须零错误通过。

## 5. 存档说明（验收常用）

- 存档位置：浏览器 localStorage，键名 `zen-world-save-v1`。
- **重置进度**：浏览器 DevTools → Application → Local Storage → 删除该键（或 Console 执行 `localStorage.clear()`），刷新页面。
- 存档损坏时游戏会自动把原值备份到 `zen-world-save-v1.bak` 并重置，不会崩溃。

## 6. M1 验收清单（当前里程碑）

在 `http://localhost:5173/?debug` 下逐条过：

- [ ] 地图加载流畅，调试面板显示 fps 接近 60、draw calls < 80
- [ ] 10 座山可见且互不遮挡；拖拽旋转、滚轮缩放受限位约束；停止操作约 5 秒后视角缓慢自动旋转
- [ ] 悬停任意山：山体提亮、出现山名浮签、鼠标变手型
- [ ] 点击任意山：黑场淡出 → 进入该山主题色的占位场景；点"返回地图"正常返回
- [ ] 调试面板点某山"点亮"：山体约 1.2s 渐变为暖色、灯亮、出现灯笼；再点可熄灭
- [ ] 点亮若干山后**刷新页面**：点亮状态保留，右上角进度显示正确 x/10
- [ ] 首次进入有操作提示且约 3 秒消失；刷新后不再出现（清存档后再次出现）
- [ ] 静音按钮图标切换，刷新后状态保留（M1 暂无声音，仅验证状态持久化）
- [ ] DevTools Console 把 `zen-world-save-v1` 改成非法字符串后刷新：游戏正常启动，出现 `.bak` 备份键
- [ ] `npm.cmd run build` 零错误

验收中发现问题：记录现象 + 复现步骤 + 浏览器控制台报错截图/文本，反馈后修复。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| Git Bash 提示 `npm: command not found` | 未执行第 1 节的 PATH 导出，或应使用 `npm.cmd` |
| 端口被占用 | 换端口：`npm.cmd run dev -- --port 5200`；或查 `netstat -ano \| grep <端口>` 找到 PID 后 `taskkill //PID <pid> //F` |
| 页面白屏 | 看 DevTools Console 首条报错；数据校验失败会以 `[validate]` 开头说明原因 |
| 画面全黑但 HUD 正常 | 多为显卡/WebGL 问题，换 Chrome/Edge 最新版重试 |

---

*维护说明：新增调试开关、脚本或环境变化时更新本文。*
