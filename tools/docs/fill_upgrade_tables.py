from pathlib import Path
import re
r=Path(__file__).resolve().parents[2];s=(r/'src/game/data/upgrades.ts').read_text();out={k:[] for k in ['general','vishdal','amiya','saria','muelsyse']}
for b in re.split(r'\{\s*id:\s*',s)[1:]:
 def get(k):
  m=re.search(r'\b'+k+r":\s*'([^']*)'",b);return m.group(1) if m else ''
 name=get('name');owner=get('owner');desc=get('description');rarity=get('rarity');m=re.search(r'maxStacks:\s*(\d+)',b)
 if owner in out and name and m:out[owner].append((name,{'silver':'银','gold':'金','prismatic':'棱彩'}[rarity]+' / '+m.group(1)+'层',desc))
assert list(map(len,out.values()))==[8,4,4,4,4],{k:len(v) for k,v in out.items()}
p=r/'docs/human/01-游戏说明书.md';s=p.read_text()
for key,owner in [('GENERAL','general'),('VISH','vishdal'),('AMIYA','amiya'),('SARIA','saria'),('MUELSYSE','muelsyse')]:
 table='| 名称 | 稀有度 / 上限 | 效果 |\n| --- | --- | --- |\n'+'\n'.join('| '+' | '.join(row)+' |' for row in out[owner])
 start='<!-- catalog:'+owner+':start -->'; end='<!-- catalog:'+owner+':end -->'
 block=start+'\n'+table+'\n'+end
 if start in s:
  s=re.sub(re.escape(start)+r'.*?'+re.escape(end),lambda m:block,s,flags=re.S)
 elif '{{'+key+'_UPGRADES}}' in s:s=s.replace('{{'+key+'_UPGRADES}}',block)
 elif table in s:s=s.replace(table,block,1)
 else:raise RuntimeError('Missing catalog section '+owner)
p.write_text(s)
print('24 upgrade descriptions sourced from current code')
