#!/usr/bin/env python3
"""Create a curated local public branch. Does not create a remote or push."""
from pathlib import Path
import os,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[2]
def git(*args,env=None,input=None):return subprocess.check_output(['git',*args],cwd=ROOT,env=env,input=input)
roots={'.gitignore','README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','eslint.config.js','index.html','tools/generate-assets.mjs','docs/素材来源说明.md','docs/演示流程脚本.md','docs/character-art-direction.md','docs/game-design.md','docs/PUBLISHING.md'}
prefixes=('art/source/','tools/art/','docs/art/','src/','public/','tests/','tools/docs/','tools/design/','tools/release/','tools/perf/','docs/human/','docs/design/','docs/references/','docs/archive/','docs/perf-runs/','output/pdf/','output/share/game/','.claude/skills/agent-browser-skill/')
def allowed(p):
 return p in roots or p.startswith(prefixes) or (p.startswith('tasks/') and p.endswith('.md')) or (p.startswith('output/share/') and (p.endswith('.zip') or p.endswith('delivery-manifest.json')))
entries=[];excluded=[]
for row in git('ls-tree','-r','-z','HEAD').split(b'\0'):
 if not row:continue
 info,path=row.split(b'\t',1);mode,kind,oid=info.split();name=path.decode()
 if kind==b'blob' and allowed(name):entries.append(mode+b' '+oid+b'\t'+path+b'\0')
 else:excluded.append(name)
fd,index=tempfile.mkstemp(prefix='public-index-',dir=ROOT/'.local/run');os.close(fd);os.unlink(index)
env=os.environ.copy();env['GIT_INDEX_FILE']=index
try:
 git('read-tree','--empty',env=env);git('update-index','-z','--index-info',env=env,input=b''.join(entries));tree=git('write-tree',env=env).decode().strip()
 old=subprocess.run(['git','rev-parse','--verify','refs/heads/github-main'],cwd=ROOT,capture_output=True,text=True)
 args=['commit-tree',tree]
 if old.returncode==0:
  parent=old.stdout.strip()
  if git('rev-parse',parent+'^{tree}').decode().strip()==tree:print('Public snapshot unchanged:',parent);raise SystemExit(0)
  args+=['-p',parent]
 source=git('rev-parse','--short','HEAD').decode().strip();commit=git(*args,input=f'Publish curated game snapshot ({source})\n'.encode()).decode().strip()
 git('update-ref','refs/heads/github-main',commit)
 print('Public branch:',commit,'included',len(entries),'excluded',len(excluded))
 (ROOT/'.local/run/publication-excluded.txt').write_text('\n'.join(excluded)+'\n')
finally:
 Path(index).unlink(missing_ok=True)
