#!/usr/bin/env python3
"""Package only explicit player-facing files; never include repository-private state."""
from pathlib import Path
import zipfile,json
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/share';GAME=OUT/'game';GAME.mkdir(parents=True,exist_ok=True)
QUICK='''像素回响：泰拉试炼 | 离线试玩版

1. 先解压这个 ZIP。
2. 双击“像素回响.html”，用桌面浏览器打开。
3. Enter 开始并确认角色；WASD 八向移动；J 普攻；K/L 技能；空格闪避；Esc 暂停。
4. 升级时 1/2/3 选择焦点，Enter 确认；R 重抽（每局默认 2 次）。

首次打开请手动确认 WASD 移动、J 攻击、Esc 暂停；字母键自动化复核受工具限制，未标成全部通过。
不需要安装 Node、Python、Claude 或本地服务器。不要在聊天软件的附件预览里运行。
游戏保存到浏览器本机，不写回HTML；请尽量固定浏览器与文件位置，隐私窗口可能不保存。
四角色、9波、24种强化；单人键盘原型，不含联机或云存档。
角色形象参考《明日方舟》。供个人试玩，未提供原角色公开商用授权。
请保留 THIRD_PARTY_NOTICES.txt 中的软件许可。

完整游戏说明书、SVG原图和项目文档单独随“图文文档包”提供。
'''
(GAME/'开始试玩.txt').write_text(QUICK,encoding='utf-8')
assert (GAME/'像素回响.html').is_file() and (GAME/'THIRD_PARTY_NOTICES.txt').is_file()
minimal=OUT/'像素回响-轻量游戏包.zip'
with zipfile.ZipFile(minimal,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in ['像素回响.html','开始试玩.txt','THIRD_PARTY_NOTICES.txt']:z.write(GAME/name,'像素回响-试玩版/'+name)
docs=OUT/'像素回响-图文文档包.zip'
with zipfile.ZipFile(docs,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted((ROOT/'docs/human').rglob('*')):
  if p.is_file() and p.suffix in ['.md','.svg']:z.write(p,'像素回响-图文文档/Markdown/'+str(p.relative_to(ROOT/'docs/human')))
 for p in sorted((ROOT/'output/pdf').glob('*.pdf')):z.write(p,'像素回响-图文文档/PDF/'+p.name)
 z.writestr('像素回响-图文文档/先读我.txt','玩家：先看 PDF/01-游戏说明书.pdf。分享者：看02。维护者：看03。\nMarkdown源文档与SVG配图在Markdown文件夹，图片相对引用完整保留。\n这个文档包不包含游戏本体，游戏单独在轻量游戏包中。\n')
summary={'game_zip':str(minimal.relative_to(ROOT)),'game_zip_bytes':minimal.stat().st_size,'game_html_bytes':(GAME/'像素回响.html').stat().st_size,'docs_zip':str(docs.relative_to(ROOT)),'docs_zip_bytes':docs.stat().st_size,'pdf_count':3,'svg_count':len(list((ROOT/'docs/human/figures').glob('*.svg'))),'markdown_count':len(list((ROOT/'docs/human').glob('*.md')))}
(OUT/'delivery-manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
for p in [minimal,docs]:
 with zipfile.ZipFile(p) as z:
  assert z.testzip() is None
  assert not any(any(bad in n.split('/') for bad in ['.git','.claude','.memory','node_modules','.local']) for n in z.namelist())
 print(p,p.stat().st_size)
print(json.dumps(summary,ensure_ascii=False,indent=2))
