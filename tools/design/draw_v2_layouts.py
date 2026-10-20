from pathlib import Path
from html import escape
R=Path(__file__).resolve().parents[2];D=R/'docs/design/v0.2/art';D.mkdir(parents=True,exist_ok=True)
def rect(x,y,w,h,c,stroke='none',sw=1):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{c}" stroke="{stroke}" stroke-width="{sw}"/>'
def txt(x,y,t,n=23,c='#ECEFF5'):return f'<text x="{x}" y="{y}" font-family="STHeiti, sans-serif" font-size="{n}" fill="{c}">{escape(t)}</text>'
def line(x1,y1,x2,y2,c='#75D8CD'):return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="3"/>'
def make(name,w,h,parts):
 (D/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><title>V0.2设计示意，非当前游戏截图</title>'+''.join(parts)+'</svg>')
a=[rect(0,0,1200,830,'#151922'),txt(36,48,'波间商店',30),txt(800,48,'第 8 波完成  ·  下一波：精英',23,'#FFCF75'),rect(30,72,1140,78,'#242B37'),txt(52,120,'金币 164',30,'#FFCF75'),txt(270,120,'生命 186 / 240',23),txt(550,120,'宝箱道具 1 / 1 已领取',22),txt(52,196,'永久道具 / 自由技能 / 消耗品',22,'#75D8CD')]
for i,(name,price,benefit,cost) in enumerate([('增压弹匣',59,'伤害 +15%','攻速 -6%'),('红铜心',53,'最大生命 +25','移速 -3%'),('轻量扳机',59,'攻速 +18%','伤害 -6%'),('霜环 · 技能',82,'范围伤害 + 减速','装备到 U / I'),('疾行饮剂',24,'下一波移速 +12%','临时，1 次上限')]):
 x=32+i*227;a+=[rect(x,219,214,250,'#242B37','#FFCF75' if i==0 else '#46566A',3 if i==0 else 1),rect(x+68,240,78,64,['#B96054','#C59A63','#6089B1','#6CBBAE','#8D82BE'][i]),txt(x+17,341,name,23),txt(x+17,379,benefit,18,'#75D8CD'),txt(x+17,411,cost,18,'#F39696' if i<3 else '#B8C6DA'),txt(x+17,448,str(price)+' 金币',23,'#FFCF75')]
# Recognizable vector item icons instead of empty color blocks.
for i in range(5):
 x=32+i*227;cx=x+107
 if i==0:
  for dx in [-18,0,18]:a += [rect(cx+dx-6,253,12,38,'#FFD48B'),rect(cx+dx-6,247,12,9,'#382D33')]
 elif i==1:
  for yy,row in enumerate(['01100110','11111111','11111111','01111110','00111100','00011000']):
   for xx,v in enumerate(row):
    if v=='1':a.append(rect(cx-28+xx*7,250+yy*7,7,7,'#713D42'))
 elif i==2:a += [rect(cx-23,250,46,31,'#D8EAF1'),rect(cx-9,260,18,11,'#6089B1'),rect(cx+8,278,12,14,'#D8EAF1')]
 elif i==3:
  for xx,yy in [(25,0),(12,22),(-12,22)]:a.append(line(cx-xx,272-yy,cx+xx,272+yy,'#E3FFFF'))
 else:a += [rect(cx-18,260,36,33,'#DCE7FF'),rect(cx-7,246,14,22,'#DCE7FF'),rect(cx-10,242,20,8,'#FFCF75'),rect(cx-12,275,24,13,'#4E476D')]
a += [rect(32,490,545,153,'#242B37'),txt(54,526,'选中商品的净变化',23),txt(54,566,'伤害加成 0% → 15%   攻速倍率 1.50 → 1.44',21),txt(54,608,'购买后金币 105  ·  Enter 确认购买',21,'#FFCF75'),rect(597,490,571,153,'#242B37'),txt(620,526,'追踪配方：锻心引擎   2 / 3',23),txt(620,567,'已拥有：红铜心 / 反应护甲',20,'#75D8CD'),txt(620,608,'缺少：锻心碎片    合成费：50',20,'#F39696'),rect(32,667,545,100,'#242B37'),txt(54,704,'U：水镜替身 Lv1    I：霜环 Lv1',22),txt(54,743,'技能满槽时，购买前先选择替换位置。',18,'#B8C6DA'),rect(597,667,571,100,'#735425'),txt(622,710,'空格：准备好，进入下一波',26,'#FFDE9C'),txt(622,746,'商店没有倒计时，可以慢慢考虑。',19),txt(32,806,'方向键选商品 · Enter购买 · R重抽 · F锁定 · Tab切页    |    设计示意',18,'#ABBACB')]
make('shop-layout.svg',1200,830,a)
a=[rect(0,0,1200,460,'#151922'),txt(35,50,'18 波节奏：先做选择，再上战场',30)]
for w in range(1,19):
 row=(w-1)//9;col=(w-1)%9;x=70+col*132;y=135+row*180;color='#A97A2F' if w in [6,9,12,15] else '#B44E60' if w==18 else '#287F85'
 a+=[rect(x-38,y-35,78,70,color),txt(x-17,y+10,str(w),28)]
 if w in [6,9,12,15]:a.append(txt(x-26,y+62,'精英',20,'#FFCF75'))
 if w==18:a.append(txt(x-27,y+62,'Boss',20,'#FFAFBA'))
 if w in [2,5,8,11,14,17]:a+=[rect(x-19,y+44,40,28,'#C09654'),txt(x-24,y+97,'宝箱',18,'#FFD894')]
 if col<8:a.append(line(x+46,y,x+83,y))
a += [txt(35,438,'1–17波：清空或倒计时结束 → 奖励结算 → 商店；18波必须击败Boss。',23)]
make('wave-timeline.svg',1200,460,a)
a=[rect(0,0,1200,400,'#151922'),txt(35,48,'三个指定材料，合成一个新的成长核心',29)]
for i,(n,b) in enumerate([('红铜心','生命 / 移速代价'),('反应护甲','护甲 / 攻速代价'),('锻心碎片','受击反攻 / 移速代价')]):
 x=35+i*270;a+=[rect(x,90,240,130,'#293340'),txt(x+18,140,n,26),txt(x+18,185,b,18,'#B8C6DA')]
 if i<2:a.append(txt(x+246,166,'+',25,'#FFCF75'))
a += [txt(850,164,'→',42,'#FFCF75'),rect(930,88,235,232,'#6A4C28'),txt(947,136,'锻心引擎',29,'#FFDE9C'),txt(947,182,'生命 +80 / 护甲 +20',18),txt(947,220,'随击杀继续成长',22),txt(947,258,'移速 -6% / 成长有上限',17),txt(35,273,'消耗三种材料各1件 + 50金币；移除材料原有正负效果，再应用完整成品。',23),txt(35,323,'显示合成净变化，不叠算两份属性。多余材料保留，成品唯一，不可拆解。',22,'#B8C6DA'),txt(35,371,'设计示意 · 对应 R01，完整配方与效果见内容目录',18,'#ABBACB')]
make('recipe-flow.svg',1200,400,a)
print('Wrote 3 SVG design diagrams')
