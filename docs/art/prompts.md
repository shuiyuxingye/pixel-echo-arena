# 美术生成提示词与源图

使用内置ImageGen工具，非CLI/API密钥脚本；源图已保存在`art/source/`。下面是用于生产图集的提示规范与逐资产主体，后续重建生产PNG只需运行`npm run art:build`，不需重新生成模型图像。

## 角色（分别生成四张）

Production game sprite sheet, not concept art: exactly 4 columns × 4 rows, square transparent canvas. Rows facing down/front, right/profile, up/back, left/profile. Columns idle, walking, attacking, hurt. Same identity, scale and clothing across every cell, feet aligned, transparent margin. Exaggerated 1.5-head chibi body, massive expressive head, tiny boots, thick dark pixel outline, clustered 16-bit shading, no text, grid, floor or clipping. Hero concept is an identity/style reference, not a texture to crop.

- `demolitionist-source.png`: silver-gray hair, curled ahoge, red/black horn ornaments, sleepy amber eyes, w-shaped smile, cheeks, tiny red/black tactical clothes and chunky grenade launcher.
- `sorcerer-source.png`: brown hair, long rabbit-eared dark hood, sleepy cyan eyes, tiny w mouth, violet robe, grimoire and purple orb.
- `knight-source.png`: ivory hair, little gold horns, amber eyes, confident expression, tiny white/gold armor, oversized gold-rimmed shield and short sword.
- `tactician-source.png`: mint-white hair and ahoge, elf ears, teal eyes, w mouth, green short coat, leaf ornament, cyan water orb.

构建时从方向姿势表装配9列×5行生产布局，左向由右向镜像以保持武器一致。每个动作的落脚点归一至y=92，显示缩放0.7，逻辑碰撞半径12不变。行走采用两姿势节奏，八向施法身体复用相应四向攻击姿势，实际八向由方向指示与弹道表达。

## 怪物

`monsters-source.png`: exactly 3×3 equal transparent cells, consistent 3/4 top-down pixel-RPG view, one monster per cell, dark outlines, 3-tone material shading, humorous faces, no text, variants, grid or shadows. Row-major order: blue one-eyed slime; crimson beetle with pincers; green cannon-mouth mushroom; orange tusked armored boar; slate crab with stone shield and cyan gem; mint healer lantern spirit; panicked pink bomb creature; olive seed-pod spider mother; charcoal horned furnace golem with lava core and hammer fists. Reference: the saved enemy concept sheet.

## 场景与标题

- `arena-source.png`: orthographic top-down 1440×960 abandoned alchemical arena, desaturated blue-black slate, discreet moss, brass inlay and centered broken circular sigil, quiet open combat centre. Flat walkable floor only: no walls, props, holes, enemies, text, HUD or perspective vanishing point. Separate wall/obstacle geometry is supplied by the game.
- `title-source.png`: landscape pixel roguelite key art. Four expressive chibi heroes occupy the right half; distant furnace golem, ruined blue-black alchemical architecture, brass sigil and amber/cyan light. Left half dark with negative space for DOM title and controls. No baked-in text or UI.

## 图标

共同规则：production icon atlas, true transparency, equal square cells, one clear centered object per cell with margin; jewel-tone fantasy/steampunk 16-bit pixels, dark outline, 3-tone highlights, top-left lighting; no labels, grid or frames.

- `loot-source.png`，6×6：红铜心、弹匣、扳机、镜头、阀门、护甲、霓虹管、线圈、治疗凝胶、循环泵、靴子、底座、火种罐、棱镜、电容、孢子、磁铁、锻心碎片、镜晶、苔藓、导线、筹码、保险齿轮、火药桶；8色药剂；金币、钥匙、宝箱、经验晶体。
- `powers-source.png`，4×4：旋刃、霜环、连锁电弧、火路、炮台、治疗、盾震、重力井、水镜替身、战旗、扇射、赏金；普攻星芒、魔弹、闪避靴、榴弹爆破。
- `relics-source.png`，4×4：炉心契约、星蚀之眼、不屈圣印、群落意志、猎金之约、回响之核、逆风齿轮、折光王冠；锻心引擎、连锁反应堆、折镜机关、永昼回路、潮生母巢、命运交易所；金/银海克斯符文。

## 动画特效

`fx-source.png`: production 4×4 transparent VFX atlas. Each row has 4 consecutive expanding/dissipating frames: ember-gold explosion; cyan ice magic; turquoise water ring; purple arcane/electric vortex. Isolated centered effect in every cell, clear inner core, controlled glow, crisp pixel clusters, no characters, text, floor or painted checkerboard.
