# 像素回响：四人试炼

单人俯视角像素动作肉鸽原型。从爆破手 / 术士 / 骑士 / 战术家中选一人，在竞技场中走位、
攻击、闪避，打 18 波敌人并在波间商店里构筑。第 18 波是唯一 Boss；升级给海克斯三选一，
宝箱给永久道具，精英给核心，商店卖道具/药剂/自由技能，三件道具可以合成成品。

技术栈：TypeScript + Vite + Phaser 3（战斗渲染）+ Tailwind CSS + daisyUI 5（DOM 菜单），
测试使用 Vitest。单页静态前端，无后端、无数据库、无 API Key，运行时不需要联网获取
模型、字体或素材。

## 当前版本：V0.3 星盘熔炉美术版

![实际游戏主菜单](docs/art/screenshots/menu.png)

保留V0.2的18波、商店、两自由技能栏、宝箱、核心、六条合成与48种海克斯规则；本次由Codex直接完成美术，不启动Ralph。
四职业四向动作、八种怪物与Boss、遗迹地板、68枚基础道具/技能/核心图标、四类动画特效与暖金界面已接入实际游戏。
全部106条内容均有图标映射；48种海克斯复用对应机制图标并保留独立名称/品质框，不冒充106张独立绘制原画。

[美术清单与截图](docs/art/README.md) · [生成提示词](docs/art/prompts.md)

V0.1 的 9 波 / 24 种强化为旧基线，旧存档与旧成绩不导入 V0.2。设计与内容参数：

- [PRD](tasks/prd-v0.2-buildcraft.md)
- [系统与数值](docs/design/v0.2/01-systems-and-balance.md)
- [道具、技能、配方与海克斯目录](docs/design/v0.2/02-content-catalog.md)
- [占位显示与功能界面](docs/design/v0.2/03-art-and-interface.md)
- [延期美术方向](docs/design/v0.2/deferred-art-direction.md)
- [旧 PRD 归档](tasks/archive/v0.1/README.md)

公开仓库采用[干净发布快照](docs/PUBLISHING.md)，不包含本机完整自动开发记录。

## 交付状态（2026-10-26）

V0.2逻辑队列已收尾：64项中62项通过，2项由用户主动跳过。V0.3美术由Codex直接实施：类型检查、lint和1675项单元测试通过；分享构建按用户要求取消包体硬上限，保留素材完整内联与分发安全检查。两项未验边界继续保留：

- **US-066 人工 18 波普通构筑试玩**：用户明确要求跳过，未执行，不视为通关验证。
- **US-051 性能/泄漏检测**：用户明确要求跳过，未运行 60 秒压力与 5 次重开检查。

因此本项目**不宣称**“全部 64 项通过”“真人已通关”“V0.2 已达到 50 FPS 或无泄漏”。
构建与内联检查的证据在 `output/share/build-report.json`；分享产物见下文。

## 先选你的使用方式

**只想玩或发给朋友**：使用 `output/share/game/像素回响.html`，或解压
`output/share/像素回响-轻量游戏包.zip` 后双击 HTML。无需安装 Node、Python 或 Claude。
浏览器存档留在本机，不随游戏文件分享。单HTML与ZIP不设硬体积上限，准确字节数见构建报告，运行资源全部内联。

**看图文说明**：从 [人类文档入口](docs/human/README.md) 开始。

| 文档 | Markdown | PDF |
| --- | --- | --- |
| 游戏说明书 | [源文件](docs/human/01-游戏说明书.md) | V0.1 历史 PDF，未随 V0.2 分享包 |
| 分享与启动指南 | [源文件](docs/human/02-分享与启动指南.md) | V0.1 历史 PDF，未随 V0.2 分享包 |
| 项目现状与维护指南 | [源文件](docs/human/03-项目现状与维护指南.md) | V0.1 历史 PDF，未随 V0.2 分享包 |

V0.1 的 SVG 插图保留在 `docs/human/figures/`，只作操作与流程示意，不代表 V0.2 画面。
自动开发过程文档保留在原目录，不进入轻量分享包。

## 源码开发环境

- Node.js ≥ 24（已在 v24.21.0 验证）
- npm（依赖版本由 `package-lock.json` 锁定）

## 从源码运行（维护者）

```bash
npm install
npm run dev -- --port 5343 --strictPort
```

打开 <http://localhost:5343/>。主服务固定使用 5343，并启用严格端口：端口被占用时
Vite 会直接退出，不会静默切换到相邻端口。

生产构建与本地静态预览：

```bash
npm run build
npm run preview -- --port 5343 --strictPort
```

构建产物位于 `dist/`（单页静态文件，可直接由任意静态服务器托管）。

## 可用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务（配置默认端口 5343、`strictPort`） |
| `npm run build` | 类型检查后构建静态产物到 `dist/` |
| `npm run build:share` | 构建并内联为单文件 `output/share/game/像素回响.html`，做体积/内联静态检查 |
| `python3 tools/docs/package_delivery.py` | 打包游戏 ZIP 与文档 ZIP（需先运行 `build:share`） |
| `npm run preview` | 预览构建产物（配置默认端口 5343、`strictPort`） |
| `npm run typecheck` | TypeScript 严格类型检查（不产出文件） |
| `npm run lint` | ESLint 检查 |
| `npm run test` | Vitest 单元测试（`tests/**/*.test.ts`） |
| `npm run perf` | 性能与重开泄漏检查（需先启动开发服务） |
| `npm run assets` | 重新生成 `public/assets/` 下的像素资源 |

性能与重开泄漏检查（**本轮由用户跳过，不执行**；保留命令供未来单独安排）：

```bash
npm run perf
# 等价于 node tools/perf/perf-check.mjs
```

V0.1 曾记录 60 秒平均 58.25 FPS 与 5 次重开计数稳定；这些是旧基线证据，**不适用于
V0.2**，本项目不宣称 V0.2 达到 50 FPS 或无泄漏。

## 玩法与操作

主菜单 `Enter`/`Space` 开始 → 选角（方向键或 `WASD`，`Enter` 确认）→ 3 秒倒计时后
进入第 1 波。

| 场景 | 按键 | 行为 |
| --- | --- | --- |
| 战斗 | `W A S D` | 八方向移动，对角线速度归一化 |
| 战斗 | `J`（可按住） | 沿当前面向持续普通攻击，允许空射 |
| 战斗 | `K` / `L` | 角色战术技能 / 招牌技能 |
| 战斗 | `U` / `I` | 商店购买的自由技能，各自独立冷却 |
| 战斗 | `Space` | 按移动方向闪避（0.18 秒、前 0.15 秒无敌、冷却 3 秒） |
| 战斗 | `Tab` | 切换前方扇区提示目标，不改变面向 |
| 战斗 | `B` | 打开/关闭构筑面板（打开时暂停） |
| 海克斯 | `A/D`、`1/2/3`、`Enter`、`R` | 移动焦点 / 直接选卡 / 确认 / 重抽 |
| 商店 | 方向键、`Enter`、`R`、`F`、`Tab`、`Space` | 选卡 / 购买确认 / 重抽 / 锁定 / 切页 / 下一波 |
| 各界面 | `Esc` | 暂停或返回；海克斯选择不可用 Esc 跳过 |

- 18 波：第 1–17 波清空或倒计时结束过关并进入商店；第 18 波必须击败 Boss。
- 第 6/9/12/15 波为精英波；宝箱在 2/5/8/11/14/17 波出现。
- 等级上限 15，海克斯三选一在 2/4/6/8/10/12/14 级出现；48 种海克斯按职业池筛选。
- 构筑来源：永久道具、药剂、自由技能、精英核心、配方成品；按 `B` 查看净属性与来源分组。
- 死亡或击败第 18 波 Boss 后结算，记录最近 10 局成绩。
- 波中/选卡/波末奖励/商店进度自动续局；刷新后主菜单可「继续试炼」。
- 设置支持静音、屏震、减少动态效果与战斗键位重绑。

## 开发场景

开发环境支持固定种子与场景参数（生产构建会移除入口）：

```text
?dev=1&seed=20261020&character=amiya&wave=5&enemies=blob:3,spitter:2&hexes=H01,H02
```

- `seed`：固定本局随机序列；
- `character`：指定角色并跳过菜单/选角；
- `wave`：起始波（1–18）；
- `enemies`：覆盖起始波名册，格式 `id:数量`；
- `hexes` / `items` / `cores` / `crafted`：开局授予海克斯、道具、核心或配方成品；
- `shopOps` / `shopPotion` / `track` / `craft`：在商店与合成面板复现交易与配方场景；
- `gold` / `maxHealth` / `damageTaken` / `waveSpeed` / `eliteOnly`：受控数值场景；
- `perf=1`：隔离性能场景，维持 80 敌人 / 40 敌弹 / 3 流形同屏（本轮跳过，不运行）。

完整参数与边界见 `src/game/dev-scenario.ts` 文件头注释。只读状态通过
`window.__PIXEL_ECHO_DEV__.getSnapshot()`；实体与输入监听计数通过
`window.__PIXEL_ECHO_DEV__.getDiagnostics()`；帧率采样与 DOM 监听计数由
`window.__PIXEL_ECHO_DIAG__` 提供。以上桥只读，生产构建不包含。

## 性能与泄漏检查（本轮跳过）

**US-051 已由用户明确跳过。** 以下命令与流程保留给未来单独安排，本轮不运行，也不引用
V0.1 的旧 FPS/监听数据作为 V0.2 结论。

`tools/perf/perf-check.mjs` 通过 agent-browser（`--session` + 完整 `--cdp`）打开隔离
性能场景：

1. 用页面内 rAF 采样 60 秒，要求平均 ≥50 FPS；
2. 经真实 UI（`Esc` 暂停 → 返回选角 → `Enter` 确认）连续重开 5 局，比较 DOM /
   场景输入监听、设置订阅、存活 Phaser 实例、画布、显示对象、物理体、补间与计时器
   是否回到基线；
3. 结果写入 `docs/perf-runs/perf-<时间戳>.json`，截图写入 `screenshots/perf/`。

采样期间保持页面在前台：后台标签页会节流 rAF，脚本会把 `visibility` 写入记录并判失败。

详细演示步骤见 `docs/演示流程脚本.md`。

## 资源与素材来源

V0.3用内置ImageGen生成源图，再由`tools/art/build-art.mjs`切分、最近邻像素整理与装配；源图保存在`art/source/`，生产PNG位于`public/assets/art/`。
四角色/怪物/场景/道具/技能/特效已实际接线；墙与掩体由可编辑代码绘制。所有运行时素材本地内联，不使用外链字体。
`npm run art:build`从已保存源图重建；V0.2旧资源保留原目录。音效继续在浏览器内合成。

完整清单、生成方式与许可说明见 `docs/素材来源说明.md`。

## 目录结构

```text
index.html                    DOM 入口：主菜单、覆盖层与游戏容器
src/main.ts                   浏览器入口，挂载应用壳
src/app.ts                    菜单 / 帮助 / 设置 / 选角 → Phaser；暂停与结算面板
src/game/config.ts            视口、场地、资源键集中配置（纯数据）
src/game/arena.ts             竞技场几何与可行走性规则（纯逻辑，可单测）
src/game/combat.ts            伤害、生命、弹体与选敌规则
src/game/scenes/ArenaScene.ts Phaser 竞技场场景（渲染 + 输入 + HUD 接线）
src/game/dev-scenario.ts      开发场景参数解析（含 perf 隔离场景）
src/game/dev-snapshot.ts      只读状态快照桥
src/game/dev-diagnostics.ts   帧率采样、DOM 监听计数与存活实例计数
src/game/data/               角色、敌人、波次、道具/技能/海克斯等纯数据
src/game/run-save.ts         V2 续局快照与存储命名空间
src/game/shop-*.ts           商店货架、交易、界面视图
src/game/build-panel.ts      战斗内构筑面板（来源分组与净属性）
src/ui/                       DOM 菜单与覆盖层
src/style.css                 Tailwind CSS + daisyUI 样式
public/assets/                自制像素资源
tools/generate-assets.mjs     无依赖的 PNG 资源生成脚本
tools/release/build-share.mjs 单文件 HTML 内联与分享构建报告
tools/docs/package_delivery.py 游戏 ZIP / 文档 ZIP 打包
tools/perf/perf-check.mjs     性能与重开泄漏检查（本轮跳过）
tests/                        Vitest 单元测试
docs/演示流程脚本.md           人工演示与浏览器验收步骤
docs/素材来源说明.md           资源清单、生成方式与许可
output/share/                 单文件 HTML、ZIP、构建报告与交付清单
```

## 约定

- 源码位于 `src/`，资源位于 `public/assets/`。
- 规则与渲染分离：战斗状态与数值规则不依赖 Phaser，可直接在 Node 中测试。
- 逻辑视口固定 960×540，使用最近邻缩放；场地固定 1440×960。
- 交互与冷却按固定逻辑步长（1/60 秒）推进，不按渲染帧数计时。
- 主服务固定 5343；端口占用必须显式失败。
