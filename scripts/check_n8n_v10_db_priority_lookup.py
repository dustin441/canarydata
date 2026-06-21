#!/usr/bin/env python3
import json, os, urllib.request
from pathlib import Path

TARGETS = {
    'F4G5VdrDBAO56Kzr': ('Canary Data - Media Monitor Template', 'District Geo Validation', 'AI Analysis1'),
    'CtcTdZJbhx5I7c1M': ('Canary Data - Social Monitor', 'Pre-Filter Districts', 'AI Analysis'),
    '6hYuq91xhEYKlHnD': ('Canary Data - Media Monitor Backfill (12mo)', 'Filter1', 'AI Analysis1'),
    'dVIf6KnZklHYzQvi': ('Canary Data - Live Ingestion with Geo Validation', 'Format for AI', 'AI Analysis1'),
}
NODE_NAME='Attach DB Strategic Priorities'

def load_env():
    for p in ['/opt/data/.env','/docker/hermes-agent-bsij/.env','/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1); os.environ.setdefault(k,v.strip().strip('"').strip("'"))

def get(wid):
    base=os.environ['N8N_BASE_URL'].rstrip('/'); key=os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    req=urllib.request.Request(base+f'/api/v1/workflows/{wid}',headers={'X-N8N-API-KEY':key,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as r: return json.loads(r.read())

def text(obj): return json.dumps(obj,ensure_ascii=False)

def main():
    load_env(); failures=[]
    for wid,(name,from_node,ai_node) in TARGETS.items():
        wf=get(wid); t=text(wf)
        if wf.get('name') != name: failures.append(f'{name}: name mismatch')
        nodes={n['name']:n for n in wf.get('nodes',[])}
        if NODE_NAME not in nodes: failures.append(f'{name}: missing DB attach node')
        else:
            js=nodes[NODE_NAME].get('parameters',{}).get('jsCode','')
            for phrase in ['strategic_profiles','strategic_priorities','strategic_priority_profile','fetch']:
                if phrase not in js: failures.append(f'{name}: attach node missing {phrase}')
        con=wf.get('connections',{})
        from_targets=[target.get('node') for out in con.get(from_node,{}).get('main',[]) for target in out]
        db_targets=[target.get('node') for out in con.get(NODE_NAME,{}).get('main',[]) for target in out]
        if NODE_NAME not in from_targets: failures.append(f'{name}: {from_node} not wired to DB attach')
        if ai_node not in db_targets: failures.append(f'{name}: DB attach not wired to {ai_node}')
        if 'Strategic priority profile JSON' not in t: failures.append(f'{name}: user prompt does not include DB profile JSON')
        if 'DB_STRATEGIC_PRIORITY_PROFILE' not in t: failures.append(f'{name}: system prompt does not reference DB profile')
        if 'STRATEGIC_PRIORITY_PROFILES:{' in t or '"chiefs-for-change":[{' in t: failures.append(f'{name}: old embedded profile blob still present')
        if 'innovation_flag' not in t or 'innovation_reason' not in t: failures.append(f'{name}: legacy compatibility missing')
    if failures:
        print('FAIL V10 DB priority lookup checks')
        for f in failures: print('-',f)
        raise SystemExit(1)
    print('PASS V10 DB priority lookup checks')

if __name__=='__main__': main()
