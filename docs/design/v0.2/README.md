# V0.2 设计包

推荐先看美术图，再读系统与目录；要安排实施时看根目录 `tasks/prd-v0.2-buildcraft.md`。

1. [系统与数值](01-systems-and-balance.md)：18波、商店、奖励、轻自瞄与数值预算。
2. [内容目录](02-content-catalog.md)：24永久道具、8消耗品、12技能、8精英核心、6配方、48海克斯。
3. [美术与界面](03-art-and-interface.md)：4职业新母版、8种怪物与Boss、商店/波次/合成SVG。
4. [机器可读目录](data/catalog.json)、[波次CSV](data/waves.csv)、[经济CSV](data/economy.csv)、[Boss预算CSV](data/boss-budget.csv)。

所有内容为设计稿。概念图不是已经完成的96像素动画资源，预算计算不是通关胜率；当前游戏代码没有被修改。

复核数据：
```bash
python3 tools/design/build_v2_catalog.py
python3 tools/design/model_v2_balance.py
python3 tools/design/draw_v2_layouts.py
```
