#!/usr/bin/env python3
"""为当前工程管理一个专属的 CDP Chrome 实例（agent-browser skill 自带，无外部依赖）。

多个工程可以在同一台机器上并跑：每个工程各自持有独立的 user-data-dir
（`.cdp-browser/profile`）与独立的 CDP 端口（9333 起顺延）。浏览器以**有头模式**
启动，方便人类旁观自动化过程；多实例并存时按端口序号错开窗口位置。

状态目录锚在**当前工作目录**（不是本脚本所在目录），所以 skill 装在
`~/.claude/skills/` 还是工程内 `.claude/skills/` 都不影响，谁的 cwd 谁的实例。

子命令：
    ensure   端口探测 + 拉起实例（已在跑则复用）+ 确保 daemon 在跑，stdout 输出 ws_url
    info     打印当前实例信息（JSON），不存在则退出码 1
    stop     关闭本工程的实例
    session  打印本工程该用的 agent-browser session 名
    doctor   诊断 agent-browser daemon（报错时用）

注意：Chrome 在 --remote-debugging-port 被占用时**不会失败退出**，而是 fallback
到 IPv6 的 [::1]:同一端口，造成两个实例共用一个端口号的静默劫持。所以端口必须由
本脚本先探测再传给 Chrome，不能指望 Chrome 自己报错。

## 两层实例，别混（2026-09-02 排障后补）

- **本脚本管 Chrome**：CDP 端口 9333+，每工程一个，靠 cdp.json 的 ws_url 指纹长期复用
- **agent-browser CLI 管自己的 daemon**：Windows 上没有 Unix socket，用 TCP 端口
  模拟，端口由 session 名哈希派生（`49152 + hash(session) % 16383`，"default" 恒为
  50838）

实测两个坑：

1. **CLI 自己 spawn daemon 是坏的** —— 它会 spawn 一个 node 进程（node 计数 +1）
   但那进程立刻退出，既不建 pid 文件也不监听端口，最后报
   `Daemon failed to start (socket: ...)`。端口空闲、换 session、清干净记账都不管用；
   手动起一个 daemon 就一切正常。所以 ensure 里代它起（见 ensure_daemon）。
2. **多工程共用 default session 会互抢 50838**，一方 pid 记账丢了另一方就起不来。
   所以 session 名按工程目录名派生，两工程各自一个 daemon。

**session 隔离只作用于 daemon，不影响 Chrome 复用** —— 每轮跑 ensure 不会新建
任何实例（Chrome 靠指纹复用，daemon 靠端口 LISTEN 检测复用）。

平台：
- Windows：stop 用 taskkill /T /F；旧版 CLI 的 daemon 用 TCP 端口模拟，
  保留 ensure_daemon 的兜底逻辑。
- macOS/Linux：stop 先校验 ws_url 指纹与进程命令行，再发 SIGTERM/SIGKILL；
  agent-browser 0.39+ 的 Rust daemon 在首条命令时自动启动，socket 是
  `~/.agent-browser/<session>.sock`。doctor 直接检查该 Unix socket，
  不探测 Windows 的 TCP 端口，也不读 netstat。
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path

PORT_BASE = 9333
PORT_TRIES = 30
LAUNCH_TIMEOUT = 30.0

IS_WINDOWS = os.name == "nt"
IS_MACOS = sys.platform == "darwin"

# 相对当前工作目录
STATE_DIR = ".cdp-browser"

# Windows 路径必须保留，macOS/Linux 按各自常见安装位置补充。
if IS_WINDOWS:
    CHROME_CANDIDATES = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
elif IS_MACOS:
    CHROME_CANDIDATES = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
else:
    CHROME_CANDIDATES = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
    ]


def state_dir() -> Path:
    d = Path.cwd() / STATE_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def state_file() -> Path:
    return state_dir() / "cdp.json"


def find_chrome() -> str:
    override = os.environ.get("CDP_CHROME_PATH")
    if override:
        if not Path(override).exists():
            sys.exit(f"CDP_CHROME_PATH 指向的文件不存在：{override}")
        return override
    for p in CHROME_CANDIDATES:
        if p and Path(p).exists():
            return p
    if IS_MACOS:
        example = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif IS_WINDOWS:
        example = "C:/Program Files/Google/Chrome/Application/chrome.exe"
    else:
        example = "/usr/bin/google-chrome"
    sys.exit(
        "找不到 Chrome。请设置 CDP_CHROME_PATH 指向浏览器可执行文件，例如 "
        f"export CDP_CHROME_PATH='{example}'"
    )


def cdp_probe(port: int, timeout: float = 2.0) -> dict | None:
    """探测端口上是否有活着的 CDP 端点，返回 /json/version 的内容。"""
    import urllib.error
    import urllib.request

    for host in ("127.0.0.1", "[::1]"):
        try:
            with urllib.request.urlopen(
                f"http://{host}:{port}/json/version", timeout=timeout
            ) as r:
                data = json.load(r)
            if "webSocketDebuggerUrl" in data:
                return data
        except (urllib.error.URLError, OSError, ValueError, TimeoutError):
            continue
    return None


def port_is_free(port: int) -> bool:
    """真正空闲 = TCP 绑得上，且 IPv4/IPv6 上都没有 CDP 端点。

    必须两者都查：Chrome 撞端口时会静默 fallback 到 [::1]，只 bind 一次
    IPv4 会漏掉那种情况。
    """
    for family, addr in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        s = socket.socket(family, socket.SOCK_STREAM)
        # 不设 SO_REUSEADDR：Windows 上它会让绑定"成功"而掩盖占用
        try:
            s.bind((addr, port))
        except OSError:
            return False
        finally:
            s.close()
    return cdp_probe(port, timeout=1.0) is None


def pick_port() -> int:
    for port in range(PORT_BASE, PORT_BASE + PORT_TRIES):
        if port_is_free(port):
            return port
    sys.exit(f"{PORT_BASE}~{PORT_BASE + PORT_TRIES - 1} 全部被占用，无法启动新实例")


def read_state() -> dict | None:
    f = state_file()
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def live_state() -> dict | None:
    """已记录的实例是否还活着 —— 端口有 CDP 应答**且**就是当初那个浏览器。

    只验证端口会误判成串台：本工程实例被关掉后，别的工程跑 ensure 时可能顺延
    占到同一个端口号，此时探测照样成功，于是本工程"复用"了别人的浏览器 ——
    表现是 snapshot / screenshot 拿到别的项目的页面，且不报任何错。

    ws_url 里 `/devtools/browser/<uuid>` 每次启动都是新的，是天然的实例指纹，
    所以这里把探测结果与记录值**比对**（而不是覆盖）；不一致就视为实例已死，
    交由 ensure 重新挑端口启动。
    """
    st = read_state()
    if not st or "port" not in st:
        return None
    info = cdp_probe(int(st["port"]))
    if not info:
        return None
    if info["webSocketDebuggerUrl"] != st.get("ws_url"):
        return None
    st["browser"] = info.get("Browser", "")
    return st


def launch(port: int) -> str:
    """启动有头 Chrome，返回 WebSocket URL。

    WS URL 从 CDP /json/version 轮询获取 —— 实测部分机器上 DevToolsActivePort
    文件不会写出来，HTTP 探测更可靠。
    """
    chrome = find_chrome()
    profile = state_dir() / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    log = state_dir() / "chrome.log"

    # 多实例窗口错开，避免完全重叠挡住人类视线
    offset = (port - PORT_BASE) * 40
    args = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        f"--window-position={offset},{offset}",
        "--window-size=1280,900",
        "about:blank",
    ]

    with open(log, "wb") as fh:
        # Windows 用 DETACHED_PROCESS 脱离控制台；macOS/Linux 用新 session，
        # 让 Chrome 成为进程组组长，stop 时可连同它的 helper 一起收掉。
        detach = (
            {"creationflags": getattr(subprocess, "DETACHED_PROCESS", 0)}
            if IS_WINDOWS
            else {"start_new_session": True}
        )
        proc = subprocess.Popen(
            args, stdout=fh, stderr=subprocess.STDOUT, **detach,
        )

    deadline = time.time() + LAUNCH_TIMEOUT
    while time.time() < deadline:
        info = cdp_probe(port, timeout=1.0)
        if info:
            ws = info["webSocketDebuggerUrl"]
            state_file().write_text(
                json.dumps(
                    {"port": port, "ws_url": ws, "pid": proc.pid,
                     "profile": str(profile)},
                    ensure_ascii=False, indent=2,
                ),
                encoding="utf-8",
            )
            return ws
        if proc.poll() is not None:
            tail = log.read_text(encoding="utf-8", errors="replace")[-800:]
            sys.exit(f"Chrome 启动即退出（exit={proc.returncode}）。日志尾部：\n{tail}")
        time.sleep(0.4)

    sys.exit(f"等待 {LAUNCH_TIMEOUT}s 后 CDP 端口 {port} 仍无响应，见 {log}")


def cmd_ensure() -> None:
    """拉起（或复用）Chrome，并确保本工程 session 的 daemon 也在跑。

    两件事都幂等：Chrome 靠 live_state() 的实例指纹复用，daemon 靠端口 LISTEN
    检测复用。**每轮调 ensure 不会新建任何实例。**
    """
    sess = session_name()
    if not ensure_daemon(sess):
        # 不致命（可能稍后自己好），但必须说出来 —— 否则 CLI 那句
        # "Daemon failed to start (socket: ...)" 会被误读成浏览器起不来。
        print(f"# ⚠️  agent-browser daemon（session={sess}, "
              f"port={daemon_port(sess)}）未起来，跑 `browser.py doctor` 看诊断",
              file=sys.stderr)

    st = live_state()
    if st:
        print(st["ws_url"])
        print(f"# 复用已有实例：port={st['port']} session={sess}", file=sys.stderr)
        return
    port = pick_port()
    ws = launch(port)
    print(ws)
    print(f"# 已启动新实例：port={port} session={sess}", file=sys.stderr)


def cmd_info() -> None:
    st = live_state()
    if not st:
        print("本工程没有存活的 CDP 实例（先跑 ensure）", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(st, ensure_ascii=False, indent=2))


def _process_alive(pid: int) -> bool:
    """进程是否还活着。只用于我们自己记录的 pid。"""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _process_command(pid: int) -> str:
    """读取 pid 的完整命令行；读不到返回空串。仅 POSIX 使用。"""
    if IS_WINDOWS:
        return ""
    try:
        proc = subprocess.run(
            ["ps", "-ww", "-p", str(pid), "-o", "command="],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return (proc.stdout or "").strip()


def _stop_pid(pid: int) -> None:
    """停止已确认归属的 pid：Windows 用 taskkill，POSIX 先 SIGTERM 再 SIGKILL。"""
    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True, text=True,
        )
        return

    try:
        pgid = os.getpgid(pid)
    except OSError:
        pgid = None

    def _signal(sig: int) -> None:
        if pgid == pid:
            try:
                os.killpg(pgid, sig)
                return
            except OSError:
                pass
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass

    _signal(signal.SIGTERM)
    deadline = time.time() + 5.0
    while time.time() < deadline:
        if not _process_alive(pid):
            return
        time.sleep(0.2)
    _signal(signal.SIGKILL)


def cmd_stop() -> None:
    """只关闭当前工程确认拥有的实例。

    归属判定有两层：
    1. `live_state()` 的 ws_url 指纹 —— 端口上的 CDP 端点必须就是 cdp.json 记录的那个；
    2. POSIX 上再核对 pid 的命令行，必须同时含本工程的 profile 路径和调试端口。

    任何一层不通过都只清理本地记录，不向进程发信号，避免误关用户浏览器。
    """
    st = read_state()
    if not st:
        print("没有记录的实例，无需停止")
        return
    live = live_state()
    if not live:
        state_file().unlink(missing_ok=True)
        print(f"记录的实例已不可用（port={st.get('port')}），"
              "已清理本地记录，未向任何进程发送信号")
        return

    pid = int(live.get("pid") or 0)
    if pid <= 0:
        print(f"记录缺少 pid，拒绝停止 port={live.get('port')} 以免误杀",
              file=sys.stderr)
        sys.exit(1)

    if not IS_WINDOWS:
        cmdline = _process_command(pid)
        profile = str(live.get("profile") or "")
        port = str(live.get("port"))
        if not cmdline:
            print(f"无法读取 pid={pid} 的命令行，拒绝停止", file=sys.stderr)
            sys.exit(1)
        if ((profile and profile not in cmdline)
                or f"--remote-debugging-port={port}" not in cmdline):
            print(f"pid={pid} 的命令行与本工程实例不符，拒绝停止：\n{cmdline}",
                  file=sys.stderr)
            sys.exit(1)

    _stop_pid(pid)
    state_file().unlink(missing_ok=True)
    print(f"已停止实例 pid={pid} port={live.get('port')}")


# ── agent-browser daemon：session 隔离与诊断 ──

def session_name() -> str:
    """本工程该用的 agent-browser session 名 = 工程目录名（sanitize 后）。

    agent-browser 只接受字母数字与 -_，其余字符换成 -。
    """
    raw = Path.cwd().name or "default"
    safe = "".join(c if (c.isalnum() or c in "-_") else "-" for c in raw)
    return safe or "default"


def daemon_port(session: str) -> int:
    """Windows 旧版 daemon 的 TCP 端口（复刻 getPortForSession）。

    仅用于 Windows 分支，必须与旧版上游算法逐位一致，否则 doctor 查的是错的端口。
    macOS/Linux 的 daemon 走 Unix socket，不调用本函数。
    """
    h = 0
    for ch in session:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
        if h >= 2 ** 31:
            h -= 2 ** 32
    return 49152 + abs(h) % 16383


def _port_listening(port: int) -> bool:
    """该端口上是否有人在 LISTEN（连接测试比解析 netstat 稳）。"""
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _daemon_js() -> Path | None:
    """定位 agent-browser 的 daemon.js（npm 全局安装路径）。"""
    cands = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        cands.append(Path(appdata) / "npm/node_modules/agent-browser/dist/daemon.js")
    cands.append(
        Path.home() / "AppData/Roaming/npm/node_modules/agent-browser/dist/daemon.js"
    )
    for p in cands:
        if p.exists():
            return p
    return None


def ensure_daemon(session: str, timeout: float = 12.0) -> bool:
    """确保该 session 的 agent-browser daemon 在跑；已在跑则直接复用。

    macOS/Linux：agent-browser 0.39+ 是原生 Rust CLI，首条命令会自动拉起
    daemon，socket 为 `~/.agent-browser/<session>.sock`。这里不需要代起，
    也不应探测 Windows 的 TCP 端口，直接返回 True。

    Windows：保留旧版 CLI 的兜底逻辑 —— CLI 自己 spawn daemon 起不来，
    这里代它起，否则会报 `Daemon failed to start (socket: ...)`。
    """
    if not IS_WINDOWS:
        return True

    port = daemon_port(session)
    if _port_listening(port):
        return True
    js = _daemon_js()
    if js is None:
        return False
    env = dict(os.environ, AGENT_BROWSER_SESSION=session)
    log = state_dir() / "agent-browser-daemon.log"
    try:
        # 必须 Popen + DETACHED_PROCESS，不要走 `cmd /c start /B`：后者在
        # Git Bash 下会继承调用方的 stdout 管道，subprocess.run 等管道关闭
        # 而挂住（实测卡满 2 分钟）。stdout 也要重定向到文件而非继承 ——
        # daemon 是长驻进程，握着我们的管道就永远等不到 EOF。
        with open(log, "ab") as fh:
            subprocess.Popen(
                ["node", str(js)],
                cwd=str(js.parent.parent), env=env,
                stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            )
    except (OSError, subprocess.SubprocessError):
        return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_listening(port):
            return True
        time.sleep(0.4)
    return False


def cmd_session() -> None:
    print(session_name())


def _agent_browser_session_info(session: str) -> dict | None:
    """调用真实 CLI 的 `session info --json`，返回 data 段；失败返回 None。"""
    exe = shutil.which("agent-browser")
    if not exe:
        return None
    try:
        proc = subprocess.run(
            [exe, "--session", session, "session", "info", "--json"],
            capture_output=True, text=True, timeout=20,
            encoding="utf-8", errors="replace",
        )
    except (OSError, subprocess.SubprocessError):
        return None
    raw = (proc.stdout or "").strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        # CLI 可能先输出提示行，最后一行才是 JSON
        lines = [ln for ln in raw.splitlines() if ln.strip()]
        try:
            obj = json.loads(lines[-1])
        except (json.JSONDecodeError, IndexError):
            return None
    data = obj.get("data") if isinstance(obj, dict) else None
    return data if isinstance(data, dict) else None


def _unix_socket_status(path: Path) -> str:
    """真实探测 Unix socket，返回 listen / blocked / stale / missing。

    区分 blocked 很重要：macOS 沙箱会允许 `stat` 但不允许 AF_UNIX connect，
    报 PermissionError。若把它当成 stale，doctor 会误报 daemon 已死。
    """
    try:
        if not stat.S_ISSOCK(path.stat().st_mode):
            return "missing"
    except OSError:
        return "missing"
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(1.0)
    try:
        s.connect(str(path))
        return "listen"
    except PermissionError:
        return "blocked"
    except OSError:
        return "stale"
    finally:
        s.close()


def _doctor_windows(sess: str) -> None:
    """Windows 旧版 daemon 诊断：TCP 端口 + netstat + pid 记账。"""
    port = daemon_port(sess)
    app = Path.home() / ".agent-browser"
    pid_file = app / f"{sess}.pid"
    print(f"session    : {sess}")
    print(f"daemon 端口 : {port}（由 session 名哈希派生，恒定）")

    holder = None
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
        for ln in out.splitlines():
            if f":{port} " in ln and "LISTENING" in ln.upper():
                holder = ln.split()[-1]
                break
    except OSError:
        pass
    recorded = pid_file.read_text(encoding="utf-8").strip() if pid_file.exists() else None
    print(f"端口占用者  : {holder or '无'}")
    print(f"pid 文件    : {recorded or '不存在'}")

    if holder and recorded == holder:
        print("→ 正常：daemon 活着且记账一致，无需处理")
    elif holder and recorded != holder:
        print("→ 记账不一致（pid 文件丢失或指向别的进程）。CLI 会误判成没有 daemon "
              "并尝试新起，撞 EADDRINUSE 后报 socket 错误。")
        print(f"   修：taskkill //PID {holder} //F  然后重跑 `browser.py ensure`")
    elif recorded and not holder:
        print("→ 陈旧 pid 文件（daemon 已死），已删除。重跑 `browser.py ensure` 即可。")
        pid_file.unlink(missing_ok=True)
        (app / f"{sess}.port").unlink(missing_ok=True)
    else:
        print("→ 端口空闲且无记账（干净状态）。重跑 `browser.py ensure`，"
              "它会代 CLI 起 daemon。")


def cmd_doctor() -> None:
    """诊断 daemon 故障。

    要治的是 `Daemon failed to start (socket: ...)`。Windows 旧版与 macOS/Linux
    的成因不同：前者查 TCP 端口与 netstat 记账；后者查真实的 Unix socket 和
    `agent-browser session info --json`，不伪造 Windows 端口检查。
    """
    sess = session_name()
    if IS_WINDOWS:
        _doctor_windows(sess)
        return

    info = _agent_browser_session_info(sess)
    socket_dir = Path((info or {}).get("socketDir") or (Path.home() / ".agent-browser"))
    sock = socket_dir / f"{sess}.sock"
    pid_file = socket_dir / f"{sess}.pid"
    recorded = pid_file.read_text(encoding="utf-8").strip() if pid_file.exists() else None
    status = _unix_socket_status(sock)
    labels = {
        "listen": "LISTEN",
        "blocked": "存在；当前沙箱阻止连接",
        "stale": "存在但未监听",
        "missing": "不存在",
    }

    print(f"session     : {sess}")
    print(f"daemon socket: {sock}（{labels[status]}）")
    print(f"pid 文件     : {recorded or '不存在'}")
    if info is None:
        print("CLI 状态     : 无法取得 `agent-browser session info --json`"
              "（未安装或调用失败）")
    else:
        pid = info.get("pid") or recorded
        print(f"CLI 状态     : active={info.get('active')} "
              f"pid={pid} pages={info.get('pageCount')} "
              f"version={info.get('version')}")
        if pid:
            alive = _process_alive(int(pid))
            print(f"daemon 进程  : {'活着' if alive else '不在'}")
            cmdline = _process_command(int(pid)) if alive else ""
            if cmdline:
                print(f"命令行       : {cmdline[:240]}")

    if status == "listen" and info and info.get("active"):
        print("→ 正常：daemon 在 Unix socket 上监听，无需处理")
    elif status == "blocked":
        print("→ socket 文件存在，但当前命令被沙箱阻止连接 AF_UNIX。"
              "这不是 daemon 故障；浏览器验证命令需在允许访问该 socket 的环境中执行。")
        if info and info.get("active"):
            print("   CLI 报告 daemon 仍为 active；不要据此清理 socket 或重装。")
    elif status == "stale":
        print("→ 陈旧 socket（daemon 已死）。跑 "
              f"`agent-browser --session {sess} doctor --fix` 清理后重试；"
              "或直接重跑 `browser.py ensure` 再发一条 agent-browser 命令，"
              "CLI 会自动拉起新 daemon。")
    else:
        print("→ 当前没有 daemon（干净状态）。首条 agent-browser 命令会自动启动它。")


def main() -> None:
    # Windows 控制台/管道默认 GBK，doctor 的中文诊断会花掉甚至抛
    # UnicodeEncodeError。自己 reconfigure，不依赖调用方设 PYTHONIOENCODING。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    cmds = {"ensure": cmd_ensure, "info": cmd_info, "stop": cmd_stop,
            "session": cmd_session, "doctor": cmd_doctor}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        sys.exit(f"用法: browser.py {{{'|'.join(cmds)}}}")
    cmds[sys.argv[1]]()


if __name__ == "__main__":
    main()
