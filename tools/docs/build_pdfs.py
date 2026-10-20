#!/usr/bin/env python3
"""Render the human-facing Markdown and native SVG figures to three PDFs."""
from pathlib import Path
import re,xml.etree.ElementTree as ET
from html import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Flowable, KeepTogether
from reportlab.graphics.shapes import Drawing, Rect, Circle, Line, Polygon, String
from reportlab.graphics import renderPDF
from reportlab.lib.pagesizes import A4
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
FONT='/System/Library/Fonts/STHeiti Medium.ttc'
pdfmetrics.registerFont(TTFont('CJK',FONT,subfontIndex=0));pdfmetrics.registerFontFamily('CJK',normal='CJK',bold='CJK',italic='CJK',boldItalic='CJK')
TEAL=colors.HexColor('#087F8C');INK=colors.HexColor('#172B36');MUTED=colors.HexColor('#51636C');WIDTH=A4[0]-88
styles={
 'body':ParagraphStyle('body',fontName='CJK',fontSize=10.4,leading=17.4,textColor=INK,spaceAfter=9,wordWrap='CJK'),
 'h1':ParagraphStyle('h1',fontName='CJK',fontSize=23,leading=31,textColor=INK,spaceAfter=18,keepWithNext=True,wordWrap='CJK'),
 'h2':ParagraphStyle('h2',fontName='CJK',fontSize=14,leading=21,textColor=TEAL,spaceBefore=8,spaceAfter=10,keepWithNext=True,wordWrap='CJK'),
 'caption':ParagraphStyle('caption',fontName='CJK',fontSize=8.4,leading=12,textColor=MUTED,spaceAfter=14,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='CJK',fontSize=9.4,leading=14.6,textColor=INK,wordWrap='CJK'),
 'th':ParagraphStyle('th',fontName='CJK',fontSize=9.5,leading=14.6,textColor=colors.white,wordWrap='CJK'),
 'code':ParagraphStyle('code',fontName='CJK',fontSize=9,leading=14,textColor=INK,backColor=colors.HexColor('#F2F6F6'),borderPadding=10,spaceBefore=4,spaceAfter=14,wordWrap='CJK')
}
def inline(t):
 t=escape(t)
 t=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',t)
 t=re.sub(r'`([^`]+)`',r'<font color="#087F8C">\1</font>',t)
 # Keep useful link labels without a machine URL overwhelming prose.
 t=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'\1',t)
 return t

def col(v):return None if v in (None,'none') else colors.HexColor(v)
def svg(path):
 root=ET.parse(path).getroot();w=float(root.get('width'));h=float(root.get('height'));d=Drawing(w,h)
 for e in root:
  tag=e.tag.split('}')[-1];a=e.attrib
  n=lambda k,default=0:float(a.get(k,default))
  kw={'fillColor':col(a.get('fill','none')),'strokeColor':col(a.get('stroke','none')),'strokeWidth':n('stroke-width',1)}
  if tag=='rect':o=Rect(n('x'),h-n('y')-n('height'),n('width'),n('height'),rx=n('rx'),ry=n('rx'),**kw)
  elif tag=='circle':o=Circle(n('cx'),h-n('cy'),n('r'),**kw)
  elif tag=='line':o=Line(n('x1'),h-n('y1'),n('x2'),h-n('y2'),strokeColor=col(a.get('stroke')),strokeWidth=n('stroke-width',1))
  elif tag=='polygon':
   pts=[float(x) for x in re.split(r'[ ,]+',a['points'].strip())];pts=[v if i%2==0 else h-v for i,v in enumerate(pts)];o=Polygon(pts,**kw)
  elif tag=='text':o=String(n('x'),h-n('y'),''.join(e.itertext()),fontName='CJK',fontSize=n('font-size',20),fillColor=col(a.get('fill','#172B36')),textAnchor=a.get('text-anchor','start'))
  else:continue
  d.add(o)
 return d
class SVGFlow(Flowable):
 def __init__(self,path,width=WIDTH):
  Flowable.__init__(self);self.d=svg(path);self.scale=width/self.d.width;self.width=width;self.height=self.d.height*self.scale
 def draw(self):
  self.canv.saveState();self.canv.scale(self.scale,self.scale);renderPDF.draw(self.d,self.canv,0,0);self.canv.restoreState()

def blocks(md,base):
 lines=md.splitlines();out=[];i=0
 while i<len(lines):
  l=lines[i].strip()
  if not l:i+=1;continue
  if l=='<!-- pagebreak -->':out.append(PageBreak());i+=1;continue
  if l.startswith('<!--'):i+=1;continue
  if l.startswith('# '):out.append(Paragraph(inline(l[2:]),styles['h1']));i+=1;continue
  if l.startswith('## '):out.append(Paragraph(inline(l[3:]),styles['h2']));i+=1;continue
  m=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',l)
  if m:
   out.append(KeepTogether([SVGFlow(base/m[2]),Spacer(1,6),Paragraph(inline(m[1]),styles['caption'])]));i+=1;continue
  if l.startswith('```'):
   code=[];i+=1
   while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
   out.append(Paragraph('<br/>'.join(escape(x).replace(' ','&#160;') for x in code),styles['code']));i+=1;continue
  if l.startswith('|'):
   rows=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    r=[x.strip() for x in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r':?-+:?',x) for x in r):rows.append(r)
    i+=1
   cols=len(rows[0]);ratios=([.24,.20,.56] if rows[0][0]=='名称' else [.22,.32,.46]) if cols==3 else [.32,.68] if cols==2 else [1/cols]*cols
   data=[[Paragraph(inline(x),styles['th'] if j==0 else styles['cell']) for x in r] for j,r in enumerate(rows)]
   t=Table(data,colWidths=[WIDTH*r for r in ratios],repeatRows=1,hAlign='LEFT')
   t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F2F6F6'),colors.white]),('LINEBELOW',(0,-1),(-1,-1),.5,colors.HexColor('#B5CCCC'))]));out.extend([t,Spacer(1,14)]);continue
  if l.startswith('- ') or re.match(r'^\d+\. ',l):
   out.append(Paragraph(inline(l),styles['body']));i+=1;continue
  para=[l];i+=1
  while i<len(lines) and lines[i].strip() and not re.match(r'^(#|!\[|\||```|<!--|- |\d+\. )',lines[i].strip()):para.append(lines[i].strip());i+=1
  out.append(Paragraph(inline(''.join(para)),styles['body']))
 return out

def build(file):
 p=ROOT/'docs/human'/file;output=OUT/(p.stem+'.pdf');title=p.stem.split('-',1)[1]
 def decor(c,doc):
  c.saveState();c.setFillColor(TEAL);c.rect(0,A4[1]-12,A4[0],12,fill=1,stroke=0)
  c.setFont('CJK',8);c.setFillColor(MUTED);c.drawString(44,A4[1]-35,'像素回响 / '+title);c.drawRightString(A4[0]-44,A4[1]-35,'2026.10 · v0.1')
  c.setStrokeColor(colors.HexColor('#D6E0E1'));c.line(44,40,A4[0]-44,40);c.setFont('CJK',8);c.drawString(44,26,'PIXEL ECHO  ·  桌面试玩版');c.drawRightString(A4[0]-44,26,str(doc.page));c.restoreState()
 doc=SimpleDocTemplate(str(output),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=58,bottomMargin=53,title=title,author='像素回响项目',pageCompression=1)
 doc.build(blocks(p.read_text(),p.parent),onFirstPage=decor,onLaterPages=decor)
 print(output)
if __name__=='__main__':
 for file in ['01-游戏说明书.md','02-分享与启动指南.md','03-项目现状与维护指南.md']:build(file)
