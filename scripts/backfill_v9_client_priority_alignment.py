#!/usr/bin/env python3
"""Backfill Strategic Alignment using client-specific strategic priority seed labels.

Updates only legacy display fields:
- innovation_flag
- innovation_reason

Classification is deliberately conservative: it matches exact seeded labels/aliases against
headline/summary/notes/tags only (not source_query) to avoid aligning merely because a query
contained a priority term.
"""
import argparse, collections, datetime as dt, json, os, re, urllib.parse, urllib.request
from pathlib import Path

SEED_PATH=Path('data/strategic-priorities.seed.json')
BACKUP_ROOT=Path('/tmp/canary_v9_client_priority_backfill')


def load_env():
    for p in ['/opt/data/.env','/docker/hermes-agent-bsij/.env','/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1); os.environ.setdefault(k,v.strip().strip('"').strip("'"))


def supabase_creds():
    url = os.environ.get('SUPABASE_URL') or os.environ.get('CANARY_SUPABASE_URL') or 'https://fehdonfrlsrrkzaemkxp.supabase.co'
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('CANARY_SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        raise RuntimeError('Set SUPABASE_SERVICE_ROLE_KEY in the runtime environment; do not scrape or hardcode Supabase keys.')
    return url, key


def http_json(method,url,key,params=None,body=None,prefer=None):
    headers={'apikey':key,'Authorization':'Bearer '+key,'Accept':'application/json'}
    if prefer: headers['Prefer']=prefer
    data=None
    if body is not None:
        headers['Content-Type']='application/json'; data=json.dumps(body).encode()
    if params: url += '?' + urllib.parse.urlencode(params,doseq=True)
    req=urllib.request.Request(url,data=data,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as r:
        raw=r.read().decode(); return r.headers, json.loads(raw) if raw else None


def fetch_all(base,key):
    rows=[]; off=0; lim=1000
    while True:
        _,batch=http_json('GET',base+'/rest/v1/news_stories',key,params={
            'select':'id,created_at,date,headline,summary,tags,notes,district_id,innovation_flag,innovation_reason,relevance_score,source_type',
            'order':'created_at.asc','limit':str(lim),'offset':str(off)})
        if not batch: break
        rows.extend(batch)
        if len(batch)<lim: break
        off+=lim
    return rows


def compile_profiles():
    seed=json.loads(SEED_PATH.read_text())['profiles']
    compiled={}
    for did,profile in seed.items():
        priorities=[]
        for p in profile.get('priorities',[]):
            terms=[p['label']] + p.get('aliases',[])
            # Avoid broad one-word terms that overmatch unless they are distinctive.
            safe=[]
            for t in terms:
                tl=t.strip()
                if len(tl)<4: continue
                if tl.lower() in {'safe','family','community','teacher','staff','career','college','student','students','learning','resources','innovation','leadership','communication','equity'}:
                    continue
                safe.append(tl)
            if safe:
                priorities.append({'label':p['label'],'terms':safe,'confidence':p.get('confidence','needs_review')})
        compiled[did]=priorities
    return compiled


def row_text(row):
    tags=row.get('tags')
    if isinstance(tags,list): tags=' '.join(str(x) for x in tags)
    elif tags is None: tags=''
    return re.sub(r'\s+',' ', ' '.join(str(row.get(k) or '') for k in ['headline','summary','notes']) + ' ' + tags).strip()


def legacy_candidate(row):
    reason=str(row.get('innovation_reason') or '').strip()
    return bool(row.get('innovation_flag')) or (reason and not re.fullmatch(r'n/?a|not applicable|none|null|undefined|-',reason,re.I))


def classify(row,profiles):
    try: relevance=float(row.get('relevance_score') or 0)
    except Exception: relevance=0
    if relevance and relevance <= 1: return False,'N/A','low_relevance'
    did=row.get('district_id')
    priorities=profiles.get(did) or []
    if not priorities:
        return False,'N/A','no_profile'
    text=row_text(row)
    if not text: return False,'N/A','blank'
    lower=text.lower()
    # Score by count and specificity. Longer terms beat broad terms.
    best=None
    for p in priorities:
        hits=[]
        for term in p['terms']:
            pattern=r'\b'+re.escape(term.lower()).replace('\\ ','\\s+')+r'\b'
            if re.search(pattern, lower): hits.append(term)
        if hits:
            score=sum(len(h) for h in hits) + 25*len(hits)
            if best is None or score>best[0]: best=(score,p,hits)
    if not best:
        return False,'N/A','no_match'
    p=best[1]
    explanation=f'This story connects to {p["label"]} based on the monitored organization’s stated strategic priority language.'
    return True, f'**{p["label"]}** – {explanation}', p['label']


def patch_row(base,key,row_id,flag,reason):
    return http_json('PATCH',base+'/rest/v1/news_stories',key,params={'id':'eq.'+row_id},body={'innovation_flag':flag,'innovation_reason':reason},prefer='return=minimal')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--apply',action='store_true'); ap.add_argument('--limit',type=int,default=0)
    args=ap.parse_args(); load_env(); base,key=supabase_creds(); profiles=compile_profiles()
    ts=dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ'); out=BACKUP_ROOT/ts; out.mkdir(parents=True,exist_ok=True)
    rows=fetch_all(base,key); (out/'news_stories_before_v9_client_priority_backfill.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
    planned=[]; cats=collections.Counter(); changed=collections.Counter()
    for row in rows:
        flag,reason,cat=classify(row,profiles); cats[cat]+=1
        old_reason=(row.get('innovation_reason') or 'N/A').strip()
        # Historical cleanup only: recode rows that already had an alignment value.
        # Do not upgrade previously N/A rows in a deterministic backfill; new live AI
        # can assign client-specific alignment going forward with full article context.
        should_consider = legacy_candidate(row)
        if should_consider and (bool(row.get('innovation_flag'))!=flag or old_reason!=reason):
            planned.append({'id':row['id'],'district_id':row.get('district_id'),'headline':row.get('headline'),'old_flag':row.get('innovation_flag'),'old_reason':row.get('innovation_reason'),'new_flag':flag,'new_reason':reason,'category':cat})
            changed[cat]+=1
    (out/'planned_changes.json').write_text(json.dumps(planned,indent=2,ensure_ascii=False))
    print('rows_total',len(rows)); print('planned_changes',len(planned)); print('category_counts',dict(cats)); print('changed_counts',dict(changed)); print('output_dir',out)
    for item in planned[:20]:
        print('-',item['district_id'], (item.get('headline') or '')[:100]); print('  old:',item.get('old_reason')); print('  new:',item.get('new_reason'))
    if not args.apply:
        print('DRY_RUN_ONLY'); return
    todo=planned[:args.limit] if args.limit else planned; errors=[]
    for i,item in enumerate(todo,1):
        try: patch_row(base,key,item['id'],item['new_flag'],item['new_reason'])
        except Exception as e: errors.append({'id':item['id'],'error':str(e)})
        if i%100==0: print('updated',i,'/',len(todo),'errors',len(errors))
    (out/'errors.json').write_text(json.dumps(errors,indent=2))
    if errors: raise SystemExit(2)
    after=fetch_all(base,key); (out/'news_stories_after_v9_client_priority_backfill.json').write_text(json.dumps(after,indent=2,ensure_ascii=False))
    # A second dry run is the authoritative verification because rows intentionally
    # converted to N/A are no longer legacy candidates after update.
    rem=[]
    for row in after:
        flag,reason,cat=classify(row,profiles); old_reason=(row.get('innovation_reason') or 'N/A').strip()
        if legacy_candidate(row) and (bool(row.get('innovation_flag'))!=flag or old_reason!=reason): rem.append(row['id'])
    (out/'remaining_diffs.json').write_text(json.dumps(rem,indent=2))
    print('errors',len(errors)); print('remaining_diffs_after_apply',len(rem)); print('output_dir',out)

if __name__=='__main__': main()
