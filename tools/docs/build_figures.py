from pathlib import Path
from html import escape
from PIL import Image
import math
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'docs/human/figures';OUT.mkdir(parents=True,exist_ok=True)
INK='#172B36';MUTED='#51636C';TEAL='#087F8C';GOLD='#DF9D38';BG='#F2F6F6';WHITE='#FFFFFF';RED='#C65757'
class Figure:
 def __init__(self,w,h,title):
  self.w=w;self.h=h;self.parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img"><title>{escape(title)}</title>'];self.rect(0,0,w,h,BG)
 def rect(self,x,y,w,h,fill=WHITE,stroke='none',sw=1,r=12):self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
 def text(self,x,y,t,size=23,fill=INK,anchor='start'):self.parts.append(f'<text x="{x}" y="{y}" font-family="STHeiti, PingFang SC, sans-serif" font-size="{size}" fill="{fill}" text-anchor="{anchor}">{escape(t)}</text>')
 def line(self,x1,y1,x2,y2,col=TEAL,sw=3):self.parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{sw}"/>')
 def circ(self,x,y,r,fill=TEAL,stroke='none',sw=1):self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
 def poly(self,pts,fill=TEAL):self.parts.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in pts)+f'" fill="{fill}"/>')
 def arrow(self,x1,y1,x2,y2,col=TEAL):
  self.line(x1,y1,x2,y2,col);a=math.atan2(y2-y1,x2-x1);self.poly([(x2,y2),(x2-12*math.cos(a-.45),y2-12*math.sin(a-.45)),(x2-12*math.cos(a+.45),y2-12*math.sin(a+.45))],col)
 def sprite(self,name,x,y,scale=3):
  im=Image.open(ROOT/f'public/assets/sprites/player-{name}.png').convert('RGBA')
  for row in range(64):
   col=0
   while col<64:
    rgba=im.getpixel((col,row));end=col+1
    while end<64 and im.getpixel((end,row))==rgba:end+=1
    if rgba[3]:self.rect(x+col*scale,y+row*scale,(end-col)*scale,scale,'#%02x%02x%02x'%rgba[:3],r=0)
    col=end
 def box(self,x,y,w,h,label,sub='',accent=TEAL):
  self.rect(x,y,w,h);self.rect(x,y,6,h,accent,r=0);self.text(x+20,y+42,label,25)
  if sub:self.text(x+20,y+78,sub,19,MUTED)
 def save(self,name):
  self.parts.append('</svg>');(OUT/name).write_text('\n'.join(self.parts),encoding='utf-8')
# Actual runtime sprites are losslessly represented with vector pixel runs.
f=Figure(1000,440,'四名可选角色：由实际游戏精灵转为矢量像素展示')
for i,(id,n,role,col) in enumerate([('vishdal','维什戴尔','爆破 / 标记',RED),('amiya','阿米娅','术法 / 真伤',TEAL),('saria','塞雷娅','盾击 / 治疗',GOLD),('muelsyse','缪尔赛思','流形 / 控制','#479C85')]):
 x=25+i*245;f.rect(x,30,220,380);f.rect(x+18,48,184,6,col,r=0);f.sprite(id,x+14,75,3);f.text(x+110,322,n,26,anchor='middle');f.text(x+110,362,role,21,MUTED,'middle')
f.save('01-characters.svg')
f=Figure(1000,260,'从打开游戏到通关的流程')
labels=[('打开 HTML','不需服务器'),('选择角色','四人任选'),('战斗升级','三选一强化'),('第 9 波','挑战 Boss')]
for i,(a,b) in enumerate(labels):
 x=24+i*246;f.box(x,55,220,110,a,b)
 if i<3:f.arrow(x+222,110,x+242,110)
f.text(500,222,'失败也会结算；同角色重开或返回选角，下一局重新构筑。',23,MUTED,'middle');f.save('02-journey.svg')
f=Figure(1000,350,'默认键盘操作')
def key(x,y,w,label,sub):
 f.rect(x,y,w,60,WHITE,TEAL,2);f.text(x+w/2,y+40,label,30,anchor='middle');f.text(x+w/2,y+91,sub,19,MUTED,'middle')
key(115,42,80,'W','上');key(25,155,80,'A','左');key(115,155,80,'S','下');key(205,155,80,'D','右')
key(365,70,95,'J','普通攻击');key(480,70,95,'K','战术技能');key(595,70,95,'L','招牌技能');key(735,70,200,'SPACE','闪避')
for x,label,sub in [(365,'TAB','目标提示'),(560,'ESC','暂停 / 返回'),(755,'ENTER','确认 / 继续')]:key(x,205,170,label,sub)
f.save('03-keyboard.svg')
f=Figure(1000,360,'八向移动与面向施法示意')
cx,cy=220,185
for i in range(8):
 a=i*math.pi/4;f.arrow(cx+40*math.cos(a),cy+40*math.sin(a),cx+130*math.cos(a),cy+130*math.sin(a),TEAL if i else GOLD)
f.circ(cx,cy,30,INK);f.text(cx,cy+8,'你',23,WHITE,'middle')
f.box(430,32,535,85,'移动决定面向','松开按键，保留最后方向。')
f.box(430,135,535,85,'朝哪边，向哪边释放','已飞出的弹体不会跟着你转弯。',GOLD)
f.box(430,238,535,85,'Tab 不替你瞄准','只切换前方提示目标，不改变面向。')
f.save('04-facing.svg')
f=Figure(1000,480,'战斗界面信息分区示意，不是运行截图')
f.rect(20,22,960,432,'#E5ECEC',INK,2)
f.rect(38,40,340,100,WHITE);f.text(55,72,'① 生命 / 护盾 / 波次 / 经验',21);f.text(55,108,'先看血量，再看当前阶段',19,MUTED)
f.rect(692,40,266,100,WHITE);f.text(710,74,'② 已获得的强化',21);f.text(710,109,'名称、层数与效果',19,MUTED)
f.sprite('vishdal',440,185,2);f.circ(645,220,19,RED);f.arrow(563,244,625,224,GOLD)
f.text(60,290,'③ 战场：人物、敌人、预警',22);f.text(60,326,'注意方向，不要站在预警里',19,MUTED)
for i,k in enumerate(['J 普攻','K 战术','L 招牌','空格 闪避']):f.rect(48+i*235,365,220,67,WHITE,TEAL,1);f.text(158+i*235,405,k,24,anchor='middle')
f.save('05-hud.svg')
for filename,entries in [('06-ranged.svg',[('vishdal','维什戴尔','铺标记 → 榴弹余震 → 爆破清群',RED),('amiya','阿米娅','术式命中 → 冷却回转 → 真伤窗口',TEAL)]),('07-support.svg',[('saria','塞雷娅','贴近盾击 → 急救续航 → 领域控场',GOLD),('muelsyse','缪尔赛思','切换流形 → 分裂或承伤 → 控制',TEAL)])]:
 f=Figure(1000,270,'角色打法与真实像素形象')
 for i,(id,n,sub,c) in enumerate(entries):
  x=20+i*490;f.rect(x,20,470,230);f.sprite(id,x+8,35,2.5);f.text(x+190,90,n,28,c);f.text(x+190,135,sub.split(' → ')[0],22);f.text(x+190,170,' → '.join(sub.split(' → ')[1:]),20,MUTED)
 f.save(filename)
f=Figure(1000,310,'三选一强化与构筑示意')
for i,(n,tag,desc,c) in enumerate([('强袭','通用 · 银','直接提高输出',TEAL),('二次余震','维什戴尔 · 金','改变榴弹节奏',GOLD),('标记传染','维什戴尔 · 棱彩','扩大标记覆盖','#8E6BB0')]):
 x=25+i*325;f.rect(x,25,300,205,WHITE,c,3);f.text(x+25,68,str(i+1),32,c);f.text(x+25,112,n,30);f.text(x+25,153,tag,21,c);f.text(x+25,192,desc,21,MUTED)
f.text(500,279,'1 / 2 / 3 只移动焦点；Enter 确认；R 重抽（每局默认 2 次）。',22,INK,'middle');f.save('08-upgrades.svg')
f=Figure(1000,275,'九波挑战与第3、第6波的机制强化')
for i in range(9):
 x=65+i*108;col=RED if i==8 else GOLD if i in [2,5] else TEAL;f.circ(x,88,32,col);f.text(x,98,str(i+1),28,WHITE,'middle')
 if i<8:f.arrow(x+34,88,x+71,88)
for x,t1,t2 in [(173,'第 1–3 波','追击者 / 射手'),(443,'第 4–8 波','加入冲锋 / 重装'),(929,'第 9 波','双阶段 Boss')]:f.text(x,158,t1,23,anchor='middle');f.text(x,195,t2,20,MUTED,'middle')
f.text(500,246,'第 3、6 波：有额外精英；清空后再选一次机制强化。',22,GOLD,'middle');f.save('09-waves.svg')
f=Figure(1000,300,'游戏存档与浏览器之间的关系')
f.box(30,55,270,110,'固定这份游戏文件','尽量不要改名或移动');f.arrow(310,110,370,110);f.box(380,55,270,110,'同一个浏览器','不要使用隐私窗口');f.arrow(660,110,720,110);f.box(730,55,240,110,'本机存档','设置 / 续局 / 成绩')
f.text(500,226,'存档不包含在分享文件里，不会随 ZIP 发给朋友。',23,INK,'middle');f.text(500,264,'刷新恢复最近检查点，不保证精确回到关闭前一帧。',21,MUTED,'middle');f.save('10-save.svg')
f=Figure(1000,310,'分享包的最小运行依赖')
f.box(35,55,290,110,'轻量游戏包 ZIP','下载后先解压');f.arrow(335,110,405,110);f.box(415,55,550,110,'像素回响.html + 快速说明','双击 HTML，交给浏览器运行')
f.text(500,225,'不携带 node_modules、源代码、AI 日志、个人配置或存档。',22,INK,'middle');f.text(500,269,'只想玩：不需要终端，也不需要安装 Claude。',23,TEAL,'middle');f.save('11-share.svg')
f=Figure(1000,390,'接手项目时的三层结构')
f.box(35,35,930,85,'界面与场景','src/ui/ + ArenaScene.ts：菜单、键盘、战场、HUD')
f.arrow(500,126,500,153);f.box(35,160,930,85,'玩法规则与配置','src/game/：战斗、波次、强化、存档；data/：角色与数值')
f.arrow(500,251,500,278);f.box(35,285,930,85,'构建与交付','Vite → dist/；build:share → 单文件 HTML；MD + SVG → PDF')
f.save('12-architecture.svg')
print('Generated',len(list(OUT.glob('*.svg'))),'SVG figures')
