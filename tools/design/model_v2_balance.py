"""Design-only economy and effective-DPS budgets, NOT a playable game simulation."""
from pathlib import Path
import csv,json,math
R=Path(__file__).resolve().parents[2];D=R/'docs/design/v0.2/data';D.mkdir(parents=True,exist_ok=True)
elites={6:600,9:1000,12:1600,15:2400};chests={2,5,8,11,14,17};rows=[]
for w in range(1,19):
 boss=w==18;n=0 if boss else 12+3*w;t=0 if boss else 30+2*w+(8 if w in elites else 0)
 rows.append({'wave':w,'kind':'boss' if boss else 'elite' if w in elites else 'normal','timer_seconds':t,'normal_quota':n,'elite_hp':elites.get(w,0),'boss_hp':12000 if boss else 0,'chest_count':int(w in chests),'completion_gold':0 if boss else 18+3*w,'shop_after':not boss})
with (D/'waves.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
economy=[]
for name,ratio,elitewins in [('低收益',.45,2),('普通构筑',.70,4),('高收益',.90,4)]:
 kills=sum(round(x['normal_quota']*ratio) for x in rows);killgold=round(kills*2.4);clear=sum(x['completion_gold'] for x in rows);elitegold=55*elitewins;total=40+killgold+clear+elitegold
 economy.append({'preset':name,'kill_fraction':ratio,'normal_kills':kills,'average_gold_per_kill':2.4,'kill_gold':killgold,'clear_gold':clear,'elite_gold':elitegold,'starting_gold':40,'total_gold':total,'chest_items':6,'core_items':elitewins})
# Damage factors are build targets for future deterministic fixtures; not sampled shop outcomes.
profiles={'低收益':(1.45,1.25,1.18,1,1,8,230,15,1.0),'普通构筑':(1.85,1.55,1.35,1.12,1,20,320,40,1.8),'高胡构筑':(2.2,1.9,1.45,1.2,1.35,36,480,80,3.0)}
base={'爆破手':52,'术士':47,'骑士':45,'战术家':43};results=[]
for name,(d,a,h,c,r,skills,hp,armor,regen) in profiles.items():
 for hero,b in base.items():
  dps=b*d*a*h*c*r+skills;ttk=12000/dps;impact=30*100/(100+armor);expected_hits=ttk/1.4*.30;capacity=(hp+regen*ttk)/impact
  results.append({'build':name,'hero':hero,'effective_dps':round(dps,1),'boss_ttk_seconds':round(ttk,1),'health':hp,'armor':armor,'regen_per_second':regen,'expected_hits_same_player':round(expected_hits,1),'hit_capacity':round(capacity,1),'capacity_margin':round(capacity/expected_hits,2)})
for name,data in [('economy.csv',economy),('boss-budget.csv',results)]:
 with (D/name).open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=data[0]);w.writeheader();w.writerows(data)
assert len(rows)==18 and rows[8]['kind']=='elite' and sum(x['kind']=='boss' for x in rows)==1 and sum(x['shop_after'] for x in rows)==17
assert all(45<=x['boss_ttk_seconds']<=65 for x in results if x['build']=='普通构筑')
assert all(18<=x['boss_ttk_seconds']<=28 for x in results if x['build']=='高胡构筑')
assert all(x['capacity_margin']>1.3 for x in results if x['build']=='普通构筑')
print('Economy:',economy)
print('Boss budgets:',results)
print('Full countdown seconds:',sum(x['timer_seconds'] for x in rows))
