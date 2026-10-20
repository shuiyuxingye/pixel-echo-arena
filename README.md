# 像素回响：泰拉试炼

单人俯视角像素动作肉鸽原型。从维什戴尔 / 阿米娅 / 塞雷娅 / 缪尔赛思中选一人，在废弃
实验场中走位、攻击、闪避，通过 9 波敌人与双阶段 Boss，用升级三选一和 24 种机制强化
形成构筑。

技术栈：TypeScript + Vite + Phaser 3（战斗渲染）+ Tailwind CSS + daisyUI 5（DOM 菜单），
测试使用 Vitest。单页静态前端，无后端、无数据库、无 API Key，运行时不需要联网获取
模型、字体或素材。

## 先选你的使用方式

**只想玩或发给朋友**：使用 `output/share/game/像素回响.html`，或解压 `output/share/像素回响-轻量游戏包.zip` 后双击 HTML。无需安装 Node、Python 或 Claude。浏览器存档留在本机，不随游戏文件分享。

**看图文说明**：从 [人类文档入口](docs/human/README.md) 开始。

| 文档 | Markdown | PDF |
| --- | --- | --- |
| 游戏说明书 | [源文件](docs/human/01-游戏说明书.md) | [图文版](output/pdf/01-游戏说明书.pdf) |
| 分享与启动指南 | [源文件](docs/human/02-分享与启动指南.md) | [图文版](output/pdf/02-分享与启动指南.pdf) |
| 项目现状与维护指南 | [源文件](docs/human/03-项目现状与维护指南.md) | [图文版](output/pdf/03-项目现状与维护指南.pdf) |

图示源文件为 SVG，放在 `docs/human/figures/`。自动开发过程文档保留在原目录，不进入轻量分享包。

## 交付状态

2026-10-20：35 条故事中 34 条通过，US-026a（四角色完整通关与流程自动试玩）由用户人工检查后主动设为 blocked；自动开发循环已结束。
US-026b 已完成：修复重开时的设置订阅与事件监听清理，589 个测试及 typecheck/lint/build 通过；规定压力场景采样 60 秒平均 58.25 FPS，连续 5 次重开计数稳定。
验收明细见 [最终性能与重开记录](docs/perf-runs/perf-2026-10-20T02-31-47-562Z.json)。

现在玩游戏只需启动下面的开发服务，不必再次运行 Harness。

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
| `npm run preview` | 预览构建产物（配置默认端口 5343、`strictPort`） |
| `npm run typecheck` | TypeScript 严格类型检查（不产出文件） |
| `npm run lint` | ESLint 检查 |
| `npm run test` | Vitest 单元测试（`tests/**/*.test.ts`） |
| `npm run perf` | 性能与重开泄漏检查（需先启动开发服务） |
| `npm run assets` | 重新生成 `public/assets/` 下的像素资源 |

性能与重开泄漏检查（需先启动开发服务）：

```bash
npm run perf
# 等价于 node tools/perf/perf-check.mjs
```

## 玩法与操作

主菜单 `Enter`/`Space` 开始 → 选角（方向键或 `WASD`，`Enter` 确认）→ 3 秒倒计时后
进入第 1 波。

| 场景 | 按键 | 行为 |
| --- | --- | --- |
| 战斗 | `W A S D` | 八方向移动，对角线速度归一化 |
| 战斗 | `J`（可按住） | 沿当前面向持续普通攻击，允许空射 |
| 战斗 | `K` / `L` | 角色战术技能 / 招牌技能 |
| 战斗 | `Space` | 按移动方向闪避（0.18 秒、前 0.15 秒无敌、冷却 3 秒） |
| 战斗 | `Tab` | 切换前方扇区提示目标，不改变面向 |
| 强化 | `A/D`、`1/2/3`、`Enter`、`R` | 移动焦点 / 直接选卡 / 确认 / 重抽 |
| 各界面 | `Esc` | 暂停或返回；强化不可用 Esc 跳过 |

- 9 波普通/Boss 波次，第 9 波为双阶段 Boss。
- 升级三选一与 24 种机制强化，包含通用与四角色专属卡。
- 死亡或击败 Boss 后结算，记录最近 10 局成绩。
- 波中/选卡进度自动续局；刷新后主菜单可「继续试炼」。
- 设置支持静音、屏震、减少动态效果与战斗键位重绑。

## 开发场景

开发环境支持固定种子与场景参数（生产构建会移除入口）：

```text
?dev=1&seed=20261020&character=amiya&wave=5&enemies=chaser:3,shooter:2&upgrades=W01,W02
```

- `seed`：固定本局强化随机序列；
- `character`：指定角色并跳过菜单/选角；
- `wave`：起始波（1–9）；
- `enemies`：覆盖起始波名册，格式 `id:数量`；
- `upgrades`：开局直接授予强化，重复 ID 按层数逐次授予；
- `perf=1`：隔离性能场景，维持 80 敌人 / 40 敌弹 / 3 流形同屏。

只读状态通过 `window.__PIXEL_ECHO_DEV__.getSnapshot()`；实体与输入监听计数通过
`window.__PIXEL_ECHO_DEV__.getDiagnostics()`；帧率采样与 DOM 监听计数由
`window.__PIXEL_ECHO_DIAG__` 提供。以上桥只读，生产构建不包含。

## 性能与泄漏检查

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

全部像素资源为项目内自制，由无第三方依赖的 `tools/generate-assets.mjs` 直接编码 PNG：

- 竞技场：`public/assets/arena/floor.png`（1440×960）、`wall.png`、`cover.png`（32×32）；
- 四角色 64×64 Q 版精灵表：`public/assets/sprites/player-*.png`（512×320，8 列 × 5 行）；
- 音效在浏览器内用 Web Audio 振荡器实时合成，无音频文件；
- 不使用外链字体、素材或运行时网络请求。

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
src/ui/                       DOM 菜单与覆盖层
src/style.css                 Tailwind CSS + daisyUI 样式
public/assets/                自制像素资源
tools/generate-assets.mjs     无依赖的 PNG 资源生成脚本
tools/perf/perf-check.mjs     性能与重开泄漏检查
tests/                        Vitest 单元测试
docs/演示流程脚本.md           人工演示与浏览器验收步骤
docs/素材来源说明.md           资源清单、生成方式与许可
```

## 约定

- 源码位于 `src/`，资源位于 `public/assets/`。
- 规则与渲染分离：战斗状态与数值规则不依赖 Phaser，可直接在 Node 中测试。
- 逻辑视口固定 960×540，使用最近邻缩放；场地固定 1440×960。
- 交互与冷却按固定逻辑步长（1/60 秒）推进，不按渲染帧数计时。
- 主服务固定 5343；端口占用必须显式失败。
