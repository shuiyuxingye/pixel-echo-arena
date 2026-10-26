#!/usr/bin/env python3
"""Package only explicit player-facing files; never include repository-private state."""
from pathlib import Path
import zipfile, json
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/share'
GAME = OUT / 'game'
GAME.mkdir(parents=True, exist_ok=True)

MAX_GAME_ZIP_BYTES = None  # User waived the size cap; quality and completeness come first.

QUICK = '''像素回响：四人试炼 | V0.3 离线试玩版（星盘熔炉美术版）

1. 先解压这个 ZIP。
2. 双击“像素回响.html”，用桌面浏览器打开。
3. Enter 开始并确认角色；WASD 八向移动；J 普攻；K/L 技能；U/I 自由技能；空格闪避；Esc 暂停。
4. 每波结束进入商店：方向键选卡，Enter 购买/确认，R 重抽，F 锁定，Tab 切页，空格下一波。
5. 升级时 1/2/3 选择焦点，Enter 确认；R 重抽（每局默认 2 次）。B 打开构筑面板。

本版为V0.3星盘熔炉美术版：保留18波、波间商店、自由技能、道具/药剂、宝箱、精英核心、
六条合成与48种海克斯规则；四职业方向动作、怪物/Boss、遗迹、道具/技能图标和动画特效均已接入。
全部运行素材已内联，无需额外下载。

首次打开请手动确认 WASD 移动、J 攻击和 Esc 暂停；字母键自动化复核受工具限制，未标成全部通过。
不需要安装 Node、Python、Claude 或本地服务器。不要在聊天软件的附件预览里运行。
游戏保存到浏览器本机，不写回HTML；请尽量固定浏览器与文件位置，隐私窗口可能不保存。
单人键盘原型，不含联机或云存档。角色形象参考《明日方舟》，仅用于个人试玩，未提供公开商用授权。
请保留 THIRD_PARTY_NOTICES.txt 中的软件许可。

验收边界：US-066 人工 18 波试玩与 US-051 性能/泄漏检测已由用户明确跳过且未验证；
本分享包不宣称真人通关、达到 50 FPS 或无泄漏。V0.3手册以Markdown为准。
'''
(GAME / '开始试玩.txt').write_text(QUICK, encoding='utf-8')
assert (GAME / '像素回响.html').is_file() and (GAME / 'THIRD_PARTY_NOTICES.txt').is_file()

minimal = OUT / '像素回响-轻量游戏包.zip'
with zipfile.ZipFile(minimal, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in ['像素回响.html', '开始试玩.txt', 'THIRD_PARTY_NOTICES.txt']:
        z.write(GAME / name, '像素回响-试玩版/' + name)

docs = OUT / '像素回响-图文文档包.zip'
with zipfile.ZipFile(docs, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted((ROOT / 'docs/human').rglob('*')):
        if p.is_file() and p.suffix in ['.md', '.svg']:
            z.write(p, '像素回响-图文文档/Markdown/' + str(p.relative_to(ROOT / 'docs/human')))
    for p in sorted((ROOT / 'docs/art/screenshots').glob('*.png')):
        if p.name in {'menu.png', 'selection.png', 'combat-final.png', 'shop.png', 'boss.png'}:
            z.write(p, '像素回响-图文文档/art/screenshots/' + p.name)
    for p in sorted((ROOT / 'docs/art').glob('*.md')):
        z.write(p, '像素回响-图文文档/art/' + p.name)
    z.writestr(
        '像素回响-图文文档/先读我.txt',
        'V0.3玩家手册以 Markdown/01-游戏说明书.md 为准。\n'
        '分享者看 Markdown/02-分享与启动指南.md；维护者看 Markdown/03-项目现状与维护指南.md。\n'
        'SVG 配图沿用 V0.1 说明性插图，不是V0.3实际截图。\n'
        'V0.1 图文 PDF 已过期，未放入当前分享包；如确需阅读请查看仓库 output/pdf/ 并注意版本。\n'
        '验收边界：US-066 人工 18 波试玩与 US-051 性能/泄漏检测为用户跳过且未验证。\n'
        '这个文档包不包含游戏本体，游戏单独在轻量游戏包中。\n',
    )

summary = {
    'game_zip': str(minimal.relative_to(ROOT)),
    'game_zip_bytes': minimal.stat().st_size,
    'game_zip_within_limit': None,
    'size_policy': 'quality-first-no-hard-cap',
    'game_html_bytes': (GAME / '像素回响.html').stat().st_size,
    'docs_zip': str(docs.relative_to(ROOT)),
    'docs_zip_bytes': docs.stat().st_size,
    'pdf_count': 0,
    'svg_count': len(list((ROOT / 'docs/human/figures').glob('*.svg'))),
    'markdown_count': len(list((ROOT / 'docs/human').glob('*.md'))),
    'skipped_checks': ['US-066 人工 18 波试玩', 'US-051 性能/泄漏检测'],
}
(OUT / 'delivery-manifest.json').write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
)
for p in [minimal, docs]:
    with zipfile.ZipFile(p) as z:
        assert z.testzip() is None
        assert not any(
            any(
                bad in n.split('/')
                for bad in ['.git', '.claude', '.memory', 'node_modules', '.local'] + (['screenshots'] if p == minimal else [])
            )
            for n in z.namelist()
        )
    print(p, p.stat().st_size)
print(json.dumps(summary, ensure_ascii=False, indent=2))
