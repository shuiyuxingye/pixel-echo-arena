---
name: agent-browser
description: Automates browser interactions via CDP (Chrome DevTools Protocol). Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(agent-browser:*),Bash(curl:*),Bash(export:*),Bash(npm:*),Bash(command:*),Bash(python:*),Bash(python3:*)
---

# Browser Automation with agent-browser (CDP Mode)

## 安装本 skill（复制即可用）

本 skill 自带浏览器启动脚本 `scripts/browser.py`（纯标准库，无第三方依赖），
把整个目录复制到目标位置就能用，不需要拷贝其他工程文件：

```bash
# 工程级（只对该工程生效）        用户级（对所有工程生效）
<工程根>/.claude/skills/agent-browser-skill/    ~/.claude/skills/agent-browser-skill/
```

目录结构：

```
agent-browser-skill/
├── SKILL.md            # 本文件
└── scripts/
    └── browser.py      # CDP Chrome 实例管理（ensure / info / stop）
```

**路径约定**：下文所有命令里的 `$BROWSER_PY` 指向本 skill 内的 `scripts/browser.py`，
每次会话开始时设一次（两种装法都覆盖）：

```bash
BROWSER_PY=".claude/skills/agent-browser-skill/scripts/browser.py"
[ -f "$BROWSER_PY" ] || BROWSER_PY="$HOME/.claude/skills/agent-browser-skill/scripts/browser.py"
```

**解释器约定**：macOS/Linux 用 `python3`，Windows 通常用 `python`；下文用 `$PY` 指代：

```bash
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
```

**状态目录锚在当前工作目录**（`./.cdp-browser/`），不是 skill 所在目录。
所以 skill 装在用户级、被多个工程共用时，各工程仍各自持有独立实例。
把 `.cdp-browser/` 加进目标工程的 `.gitignore`。

## 0. 安装检查（必须最先执行）

每次会话开始时，**必须先检查** `agent-browser` 是否已全局安装。如未安装，**先执行全局安装**再进行后续步骤，否则所有命令都会失败。

```bash
# 检查 agent-browser 是否可用；不可用则全局安装
if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser 未安装，正在通过 npm 全局安装..."
  npm install -g agent-browser
fi

# 验证安装结果
agent-browser --version
```

注意事项：

- 检查必须用 `command -v agent-browser`（POSIX 标准、Git Bash 可用），不要用 `which`（部分环境可能不存在）。
- 安装命令固定为 `npm install -g agent-browser`，不要替换为本地安装或其它源。
- 若 `npm install -g` 报权限错误，提示用户手动以管理员/sudo 重新执行该命令，本 skill 不应静默吞掉错误。
- 安装完成后必须用 `agent-browser --version` 复验，确认二进制确实可调用，再进入下面 Prerequisites 章节继续后续步骤。

## Prerequisites

### 浏览器由 skill 自己拉起（不要求你事先开好 Chrome）

`scripts/browser.py` 负责给**当前工作目录**准备一个专属的有头 CDP Chrome：

```bash
WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)
AB_SESSION=$("$PY" "$BROWSER_PY" session)
```

`ensure` 是幂等的 —— 实例已在跑就复用，没跑就新起一个。它做四件事：

1. **端口从 9333 起顺延探测**（9333 被占就试 9334、9335…最多 30 个）。所以同一台机器上多个工程可以并跑，各占一个端口。
2. **user-data-dir 固定在 `./.cdp-browser/profile`**，与你日常用的 Chrome 完全隔离，登录态、扩展、缓存都不互相污染。
3. 把 `port` / `ws_url` / `pid` 写进 `./.cdp-browser/cdp.json`，供后续会话复用。
4. **准备本工程 session 名**；daemon 的启动按平台处理：macOS/Linux 由 agent-browser 首条命令自动拉起，Windows 旧版由 `ensure` 代起（见下方【daemon 是另一层】）。

之后每条命令都带 `--session "$AB_SESSION" --cdp "$WS_URL"`。

配套子命令：

```bash
"$PY" "$BROWSER_PY" info     # 看当前实例信息；无存活实例时退出码 1
"$PY" "$BROWSER_PY" stop     # 关掉当前工程的实例
"$PY" "$BROWSER_PY" session  # 本工程该用的 agent-browser session 名
"$PY" "$BROWSER_PY" doctor   # daemon 报错时诊断
```

### daemon 是另一层，和 Chrome 分开看

agent-browser 0.39+ 是原生 Rust CLI，daemon 在**首条命令时自动启动**，不再需要
Node、`daemon.js` 或手工代起。

- **macOS/Linux**：daemon 使用真实 Unix socket
  `~/.agent-browser/<session>.sock`，pid 记账为同目录 `<session>.pid`。
  `doctor` 直接检查该 socket 与 `agent-browser --session <sess> session info --json`，
  **不探测 TCP 端口、不读 netstat**。
- **Windows（旧版 CLI）**：没有 Unix socket 时用 TCP 端口模拟，端口由 session 名
  哈希派生（`"default"` 恒为 50838）。旧版 CLI 自己 spawn daemon 会失败并报
  `Daemon failed to start (socket: ...)`；`ensure` 保留代起兜底。多工程共用
  `default` session 会互抢 50838，所以 `session` 子命令按工程目录名派生 session 名。

**session 隔离只作用于 daemon，不影响 Chrome 复用。** 实测：连续两次 `ensure` 仍是
1 个 Chrome、同一个 ws_url；两个工程各跑 `ensure` 得到各自的 Chrome 与各自的 session。

报错时：**先重跑一次 `ensure`**（macOS/Linux 上 `ensure` 只保证 Chrome），再跑
`"$PY" "$BROWSER_PY" doctor`。它会摊开 session、真实 socket 路径、监听状态、
pid 记账与 CLI 状态，并给出对应平台的修法。

### 「已经有实例在跑，是我该用的那个吗？要不要新起一个？」

**不要自己判断，跑 `ensure` 就是答案。** 它幂等，内部已经做完了这个判断：读
`./.cdp-browser/cdp.json` → 探测记录的端口 → 是本工程的实例就复用，否则挑新端口
新起一个。想先看一眼再决定，用 `info`（无存活实例退出码 1）。

**端口号本身零信息量，不能作为归属依据。** 机器上同时活着 9333~9336 是常态，
它们可能属于别的工程、也可能是历史遗留的手工测试实例。判断归属的唯一权威是
**当前工作目录下的 `cdp.json`**：一个工程一个目录一个实例。

归属校验用 **ws_url 里的 `/devtools/browser/<uuid>`** —— 每次 Chrome 启动都是新
uuid，是天然的实例指纹。`live_state()` 拿探测结果与 `cdp.json` 记录的 ws_url
**比对**，不一致就当实例已死。只比端口会踩这条串台路径：本工程实例被关掉 →
别的工程 `ensure` 顺延占到同一端口 → 本工程再 `ensure`，探测成功于是复用了
别人的浏览器，snapshot / screenshot 拿到别的项目的页面且**不报任何错**。

**同一 profile 不能并存两个实例。** Chrome 撞 `--user-data-dir` 锁时会
**exit=0** 并在已有窗口开个标签页就退出（日志写"已在现有的浏览器会话中打开"），
看起来像成功。所以换端口前必须先 `stop`，别在旧实例还活着时直接起新的。

**为什么端口必须由脚本探测，不能直接传 9333**：Chrome 在 `--remote-debugging-port` 被占用时**不报错、不退出**，而是静默 fallback 到 IPv6 的 `[::1]:同一端口`。结果两个实例共用一个端口号，`curl localhost:9333` 拿到哪个取决于解析顺序 —— 这是静默串台，不是启动失败。`browser.py` 的 `port_is_free()` 因此对 IPv4 和 IPv6 各 bind 一次，且不设 `SO_REUSEADDR`。

Chrome 路径按常见位置自动查找（macOS: `/Applications/...`；Windows: Program Files/Edge；Linux: PATH 常见位置）。找不到时用 `CDP_CHROME_PATH` 指定。
`stop` 按平台关闭：macOS/Linux 先校验 ws_url 指纹与 `ps` 命令行（profile + 调试端口），再发 SIGTERM/SIGKILL；Windows 用 `taskkill /T /F`。任一校验不通过时只清理 `cdp.json`，不向进程发信号。

### agent-browser 自身没有这些能力（实测，别绕开脚本）

| 走法 | 实测结果 |
| --- | --- |
| 不带 `--cdp`（launch 模式） | Playwright 报 `npx playwright install`，本机 revision 对不上 |
| `--auto-connect` | `No running Chrome instance...`，即使端口上确有实例 |
| `--cdp <port>`（纯端口号） | 0.39.1 对**正确的**端口可用；端口写错只报连接拒绝。项目统一传完整 `ws://` URL |

- `--auto-connect` 的发现策略只有两步：读 Chrome **默认** user-data-dir 的
  `DevToolsActivePort`，再探测硬编码的 `[9222, 9229]`。本 skill 的 profile 和
  端口段都不在其中，所以永远找不到。
- **agent-browser 没有任何端口顺延逻辑**，顺延是 `browser.py` 的 `pick_port()`。
- `--cdp` 在 0.39.1 接受端口或 URL；本 skill 仍统一传 `ws://` URL，因为它是实例指纹，
  也是 `ensure` 与 `stop` 的归属依据。不要把端口写错后的连接拒绝误判成 CLI 故障。

### 平台环境变量

**macOS/Linux 不需要设置任何 `AGENT_BROWSER_*` 环境变量。** daemon 自动使用
`~/.agent-browser/<session>.sock`。

Windows (Git Bash/MSYS2) 旧版 CLI 的 Rust 二进制无法自行定位 `daemon.js`，才需要设置 `AGENT_BROWSER_HOME`。**别硬编码用户名路径**，从 npm 问：

```bash
export AGENT_BROWSER_HOME="$(npm root -g)/agent-browser"
```

多工程并跑时建议同时按工程隔离 daemon 的 socket 目录（实测共用也不串台，但隔离后互不影响生命周期）：

```bash
export AGENT_BROWSER_SOCKET_DIR="$PWD/.cdp-browser/ab-socket"
```

### `Daemon failed to start` 的成因矩阵（Windows 旧版实测）

> macOS/Linux 先跑 `"$PY" "$BROWSER_PY" doctor`：它检查真实 Unix socket 与
> `agent-browser session info --json`，不要套用下面的 netstat/端口思路。

同一条报错有两个完全不同的成因，靠**是否设了 HOME**区分。四种组合都实跑过：

| `AGENT_BROWSER_HOME` | `--cdp "$WS_URL"` | 结果 | 耗时 |
| --- | --- | --- | --- |
| 未设 | 无 | ✗ `Daemon failed to start` | 8.2s |
| 未设 | **有** | ✗ `Daemon failed to start` | 8.2s |
| 已设 | 无 | ✗ `browserType.launch: Executable doesn't exist ...chromium_headless_shell-1208` | 1.9s |
| **已设** | **有** | ✓ 正常输出 | 2.2s |

读法：

1. **`Daemon failed to start` = HOME 没设。** daemon 进程根本没起来（socket 目录里连 `.pid` / `.port` 都不会出现）。HOME 设了之后 1.4s 内就会写出 `.port`。切 cwd 到包目录**不能**替代 HOME，试过，照样失败。
2. **HOME 设了但报缺 chromium-1208 = 你漏了 `--cdp`。** 不带 `--cdp` 时 daemon 会自己 launch 一个 Playwright 托管的 Chromium，而 `playwright-core` 每个版本锁死一个 revision（1.58.2 → **1208**），本机装的 1187 / 1234 差一个号都不认。
3. **带上 `--cdp "$WS_URL"` 就完全不需要额外下载 Chromium。** attach 模式接的是 `browser.py ensure` 起的那个 Chrome，Playwright 那套浏览器一个都用不上。所以遇到缺 revision 的报错，**第一反应是补 `--cdp`，不是去下 Chromium。**

**冷启动第一条命令会慢**：daemon 现拉起来要 ~2.7s，且如果 stdout 被管道占着可能挂住。第二条起 ~0.5s。别把首条命令的慢当成故障。

**诊断顺序**（照这个走，别乱试）：

```bash
# 1. 报 Daemon failed to start -> 先看 HOME 设了没
echo "$AGENT_BROWSER_HOME"
# 2. 设了还失败 -> 看 socket 目录有没有 .port（没有就是 daemon 没起）
ls ~/.agent-browser/
# 3. 报缺 chromium-xxxx -> 你的命令漏了 --cdp "$WS_URL"，补上即可，别去下载
# 4. --cdp 连不上 / WS_URL 为空 -> 实例可能已被关掉，重新 ensure
PYTHONIOENCODING=utf-8 "$PY" "$BROWSER_PY" info   # 先看实例状态，无实例时退出码 1
WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)   # 幂等：复用或新起
AB_SESSION=$("$PY" "$BROWSER_PY" session)
```

**别做的事**：daemon 启动失败**连续 2 次**就停手，按上面三步查。日志里曾出现同一个 Agent 在这个报错上重试 12 次、耗掉 36 分钟，一次验证都没做成 —— 那一整轮 247 条 agent-browser 命令里只有 4 条按规定带了 `--cdp`。

**真要走 launch 模式**（本 skill 不用，仅备查）：`node node_modules/playwright-core/cli.js install chromium chromium-headless-shell`，或用 `AGENT_BROWSER_EXECUTABLE_PATH` 指到已装的 `chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`。

## 禁止事项（常见错误）

- **禁止** 使用 `agent-browser connect <port>` 或 `agent-browser connect <ws_url>` 命令
- **禁止** 通过 Node.js `require('agent-browser')` 调用，agent-browser 是原生二进制 CLI
- **禁止** 不带 `--cdp "$WS_URL"` 直接执行 `agent-browser open <url>`
- **禁止** 硬编码 9333 或任何具体端口号，一律由 `browser.py ensure` 给出 `$WS_URL`
- **禁止** 手工敲 `chrome.exe --remote-debugging-port=...` 起实例 —— 撞端口时 Chrome 会静默 fallback 到 IPv6，串到别的工程上去
- **禁止** 用「端口上探到了活着的 CDP」当作「这是本工程的实例」—— 归属只认当前工作目录的 `cdp.json`，校验靠 ws_url 里的 uuid，判断交给 `ensure`
- **禁止** 因为「没有开好的 Chrome」就判定环境不可用；`browser.py ensure` 就是用来起的
- **禁止** 用 `--auto-connect` 代替 `ensure` —— 它只认默认 profile 和 `[9222, 9229]`，找不到本 skill 的实例
- **禁止** 在 `--cdp` 里硬编码或猜测端口号；项目统一传 `ensure` 给出的完整 `ws://` URL
- **唯一正确方式**：每条命令都用 `agent-browser --session "$AB_SESSION" --cdp "$WS_URL" <command>` 格式

## 连接规则（重要）

**不要硬编码端口号。** 当前工程的 CDP 端口由 `browser.py` 探测决定（9333 起顺延），同一台机器上并跑的其他工程会占用相邻端口。假定 9333 一定是自己的，就会连到别的工程的浏览器上去。

`--cdp` 在 agent-browser 0.39.1 中接受端口或 URL，但**本项目统一传完整的 WebSocket URL**，因为 ws_url 是实例指纹，也是 `ensure` / `stop` 的归属依据。每次会话开始时获取一次 `WS_URL`，后续所有命令都带 `--cdp "$WS_URL"`：

```bash
WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)
AB_SESSION=$("$PY" "$BROWSER_PY" session)
```

为防止多个 Chrome 实例并存时串台，禁止省略 `--cdp` 参数，也不要依赖 session 缓存的默认连接。

## Quick Start（必须严格按此流程执行）

```bash
# 0a. 安装检查：未安装则自动通过 npm 全局安装
command -v agent-browser >/dev/null 2>&1 || npm install -g agent-browser

# 0b. 定位本 skill 自带的 browser.py（工程级优先，回落到用户级）
BROWSER_PY=".claude/skills/agent-browser-skill/scripts/browser.py"
[ -f "$BROWSER_PY" ] || BROWSER_PY="$HOME/.claude/skills/agent-browser-skill/scripts/browser.py"

# 0c. 解释器：macOS/Linux 用 python3，Windows 通常用 python
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python

# 0d. (仅 Windows 旧版 CLI) 设置环境变量；macOS/Linux 跳过
if [ "${OS:-}" = "Windows_NT" ]; then
  export AGENT_BROWSER_HOME="$(npm root -g)/agent-browser"
  export AGENT_BROWSER_SOCKET_DIR="$PWD/.cdp-browser/ab-socket"
fi

# 1. 拉起（或复用）当前工程专属的有头 CDP Chrome，拿到 WebSocket URL
#    端口自动从 9333 顺延，多工程并跑不冲突；每次会话执行一次即可
WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)
AB_SESSION=$("$PY" "$BROWSER_PY" session)
echo "$WS_URL"   # 空值说明启动失败，去掉 2>/dev/null 重跑看报错

# 2. 连接并打开页面
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open <url>

# 3. 每条后续命令都必须带 --cdp "$WS_URL"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i       # Get interactive elements with refs
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" click @e1         # Click element by ref
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e2 "text"   # Fill input by ref
```

## Core workflow (CDP Mode)

1. **安装检查**: `command -v agent-browser >/dev/null 2>&1 || npm install -g agent-browser`
2. 定位脚本 + 设置解释器: `BROWSER_PY=...`（见 Quick Start 0b）、`PY=python3`（macOS/Linux；Windows 用 `python`）；Windows 旧版再设 `AGENT_BROWSER_HOME`
3. 拉起/复用实例并取 WS URL 与 session: `WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)` 与 `AB_SESSION=$("$PY" "$BROWSER_PY" session)`
4. 连接并导航: `agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open <url>`
5. 获取快照: `agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i` (返回带 ref 的元素如 `@e1`, `@e2`)
6. 使用 ref 进行交互（每条命令都带 `--cdp "$WS_URL"`）
7. 页面变化后重新获取快照

## Commands

### CDP Connection
```bash
# 查看当前工程实例的端口 / ws_url / pid（无存活实例时退出码 1）
PYTHONIOENCODING=utf-8 "$PY" "$BROWSER_PY" info

# 通过完整的 WebSocket URL 连接（推荐，每条命令都带）
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open <url>
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i
```

### Navigation
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open <url>      # Navigate to URL
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" back            # Go back
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" forward         # Go forward
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" reload          # Reload page
```

### Snapshot (page analysis)
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot            # Full accessibility tree
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i         # Interactive elements only (recommended)
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -c         # Compact output
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -d 3       # Limit depth to 3
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -s "#main" # Scope to CSS selector
```

### Interactions (use @refs from snapshot)
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" click @e1           # Click
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" dblclick @e1        # Double-click
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" focus @e1           # Focus element
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e2 "text"     # Clear and type
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" type @e2 "text"     # Type without clearing
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" press Enter         # Press key
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" press Control+a     # Key combination
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" keydown Shift       # Hold key down
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" keyup Shift         # Release key
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" hover @e1           # Hover
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" check @e1           # Check checkbox
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" uncheck @e1         # Uncheck checkbox
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" select @e1 "value"  # Select dropdown
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" scroll down 500     # Scroll page
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" scrollintoview @e1  # Scroll element into view
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" drag @e1 @e2        # Drag and drop
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" upload @e1 file.pdf # Upload files
```

### Get information
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get text @e1        # Get element text
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get html @e1        # Get innerHTML
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get value @e1       # Get input value
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get attr @e1 href   # Get attribute
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get title           # Get page title
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get url             # Get current URL
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get count ".item"   # Count matching elements
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get box @e1         # Get bounding box
```

### Check state
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" is visible @e1      # Check if visible
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" is enabled @e1      # Check if enabled
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" is checked @e1      # Check if checked
```

### Screenshots & PDF
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" screenshot          # Screenshot to stdout
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" screenshot path.png # Save to file
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" screenshot --full   # Full page
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" pdf output.pdf      # Save as PDF
```

### Video recording
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" record start ./demo.webm    # Start recording
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" click @e1                   # Perform actions
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" record stop                 # Stop and save video
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" record restart ./take2.webm # Stop current + start new
```
Recording creates a fresh context but preserves cookies/storage from your session. If no URL is provided, it automatically returns to your current page. For smooth demos, explore first, then start recording.

### Wait
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait @e1                     # Wait for element
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait 2000                    # Wait milliseconds
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --text "Success"        # Wait for text
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --url "**/dashboard"    # Wait for URL pattern
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --load networkidle      # Wait for network idle
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --fn "window.ready"     # Wait for JS condition
```

### Mouse control
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" mouse move 100 200      # Move mouse
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" mouse down left         # Press button
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" mouse up left           # Release button
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" mouse wheel 100         # Scroll wheel
```

### Semantic locators (alternative to refs)
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" find role button click --name "Submit"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" find text "Sign In" click
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" find label "Email" fill "user@test.com"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" find first ".item" click
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" find nth 2 "a" text
```

### Browser settings
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set viewport 1920 1080      # Set viewport size
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set device "iPhone 14"      # Emulate device
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set geo 37.7749 -122.4194   # Set geolocation
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set offline on              # Toggle offline mode
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set headers '{"X-Key":"v"}' # Extra HTTP headers
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set credentials user pass   # HTTP basic auth
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" set media dark              # Emulate color scheme
```

### Cookies & Storage
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" cookies                     # Get all cookies
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" cookies set name value      # Set cookie
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" cookies clear               # Clear cookies
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" storage local               # Get all localStorage
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" storage local key           # Get specific key
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" storage local set k v       # Set value
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" storage local clear         # Clear all
```

### Network
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network route <url>              # Intercept requests
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network route <url> --abort      # Block requests
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network route <url> --body '{}'  # Mock response
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network unroute [url]            # Remove routes
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network requests                 # View tracked requests
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" network requests --filter api    # Filter requests
```

### Tabs & Windows
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" tab                 # List tabs
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" tab new [url]       # New tab
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" tab 2               # Switch to tab
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" tab close           # Close tab
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" window new          # New window
```

### Frames
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" frame "#iframe"     # Switch to iframe
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" frame main          # Back to main frame
```

### Dialogs
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" dialog accept [text]  # Accept dialog
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" dialog dismiss        # Dismiss dialog
```

### JavaScript
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" eval "document.title"   # Run JavaScript
```

## Example: Form submission (CDP Mode)

```bash
# 1. 拉起/复用当前工程实例
WS_URL=$("$PY" "$BROWSER_PY" ensure 2>/dev/null)
AB_SESSION=$("$PY" "$BROWSER_PY" session)

# 2. 打开表单页面
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open https://example.com/form
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

# 3. 填写并提交表单
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e1 "user@example.com"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e2 "password123"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" click @e3
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --load networkidle
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i  # Check result
```

## Example: Authentication with saved state

```bash
# Login once
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open https://app.example.com/login
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e1 "username"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" fill @e2 "password"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" click @e3
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" wait --url "**/dashboard"
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" state save auth.json

# Later sessions: load saved state
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" state load auth.json
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" open https://app.example.com/dashboard
```

## Sessions (parallel browsers)

`--session` 用于本工程 daemon 隔离（名字由 `browser.py session` 给出），不用于区分多端口实例；连接目标始终由 `$WS_URL` 显式指定。每条命令两者都带。

## JSON output (for parsing)

Add `--json` for machine-readable output:
```bash
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot -i --json
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" get text @e1 --json
```

## Debugging

```bash
# CDP 连接调试
PYTHONIOENCODING=utf-8 "$PY" "$BROWSER_PY" info   # 实例还活着吗
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" snapshot                        # 通过 ws_url 连接

# 页面调试
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" console                         # View console messages
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" console --clear                 # Clear console
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" errors                          # View page errors
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" errors --clear                  # Clear errors
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" highlight @e1                   # Highlight element
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" trace start                     # Start recording trace
agent-browser --session "$AB_SESSION" --cdp "$WS_URL" trace stop trace.zip            # Stop and save trace
```
