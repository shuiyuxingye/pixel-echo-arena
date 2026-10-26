# V0.2 设计包

本轮先做逻辑：先读系统与内容目录，再读占位显示与功能界面；实施依据为 `tasks/prd-v0.2-buildcraft.md`。用户已授权恢复Harness；当前保持逻辑优先，美术延期。

1. [系统与数值](01-systems-and-balance.md)：18波、商店、奖励、轻自瞄与数值预算。
2. [内容目录](02-content-catalog.md)：24永久道具、8消耗品、12技能、8精英核心、6配方、48海克斯。
3. [占位显示与功能界面](03-art-and-interface.md)：简单图形辨识、商店、HUD与奖励结算。
   [延期美术备忘](deferred-art-direction.md)保留原母版与设计图，本轮不执行绘制或精细视觉验收。
4. [机器可读目录](data/catalog.json)、[波次CSV](data/waves.csv)、[经济CSV](data/economy.csv)、[Boss预算CSV](data/boss-budget.csv)。

本包为 V0.2 目标规格，用户已于 2026-10-20 授权通过 Harness 实施；完成情况见 `scripts/ralph/prd.json`。概念图不是生产动画资源，预算计算不是实测通关胜率。

复核数据：
```bash
python3 tools/design/build_v2_catalog.py
python3 tools/design/model_v2_balance.py
```
