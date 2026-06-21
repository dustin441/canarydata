#!/usr/bin/env python3
import copy
import datetime
import json
import os
import re
import urllib.request
from pathlib import Path

TARGET_WORKFLOWS = {
    'F4G5VdrDBAO56Kzr': 'Canary Data - Media Monitor Template',
    'CtcTdZJbhx5I7c1M': 'Canary Data - Social Monitor',
    '6hYuq91xhEYKlHnD': 'Canary Data - Media Monitor Backfill (12mo)',
    'dVIf6KnZklHYzQvi': 'Canary Data - Live Ingestion with Geo Validation',
}
SEED_PATH = Path('data/strategic-priorities.seed.json')


def load_env():
    for p in ['/opt/data/.env','/docker/hermes-agent-bsij/.env','/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def request(method, path, payload=None):
    base=os.environ['N8N_BASE_URL'].rstrip('/')
    key=os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    data=None if payload is None else json.dumps(payload).encode()
    headers={'X-N8N-API-KEY':key,'Accept':'application/json'}
    if payload is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,data=data,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as r:
        raw=r.read().decode()
        return json.loads(raw) if raw else None


def compact_profiles():
    seed=json.loads(SEED_PATH.read_text())
    out={}
    for district_id, profile in seed['profiles'].items():
        out[district_id]=[
            {'label':p['label'],'aliases':p.get('aliases',[]),'confidence':p.get('confidence','needs_review')}
            for p in profile.get('priorities',[])
            if p.get('label')
        ]
    return out


def build_v9_block():
    profiles=json.dumps(compact_profiles(),ensure_ascii=False,separators=(',',':'))
    return f'''STRATEGIC ALIGNMENT FIELD — V9 CLIENT-SPECIFIC PRIORITY MATCHING (stored for the live dashboard in legacy JSON keys innovation_flag and innovation_reason, while also returning explicit keys strategic_alignment and alignment_explanation):
Strategic Alignment is not a generic education theme. It must connect the story to the monitored organization's own strategic language.

Priority source of truth:
- Use the STRATEGIC_PRIORITY_PROFILES JSON below when the current district_id is present.
- Match against priority labels and aliases, but output the exact provided priority label.
- Do not output generic labels unless that exact label exists in the profile for this district_id.
- If the story appears to match an alias, use the corresponding exact label. Example: for Chiefs for Change, college/career/CTE/workforce stories should map to "Postsecondary Pathways" when the evidence is strong enough, not to a generic college/career label.
- If a district_id has no profile or the profile is low confidence, assign Strategic Alignment only when the content itself explicitly names a strategic plan, mission, vision, board goal, pillar, priority, or named district initiative.

Assignment threshold:
Only assign Strategic Alignment when there is a strong and defensible connection to one of the provided priorities or to an explicitly named priority in the content. The connection should be clear enough that a district/client leader would reasonably agree. If confidence is below 80%, do not assign an alignment.

Output rules:
- strategic_alignment: the exact label from STRATEGIC_PRIORITY_PROFILES for this district_id, or "-" when no strong match exists.
- alignment_explanation: one concise sentence (15–30 words) explaining the evidence-based connection to that exact priority, or "-".
- innovation_flag: true only when strategic_alignment is not "-".
- innovation_reason: format as **Exact Priority Label** – Alignment Explanation, or "N/A".

Do not force alignment. Routine operational updates, traffic notices, weather alerts, generic announcements, isolated events, general achievement posts, or content with no meaningful connection to a provided/client-specific priority should receive "-" and "N/A".

STRATEGIC_PRIORITY_PROFILES:
{profiles}

Example with provided profile:
If district_id is "chiefs-for-change" and the story is about CTE, workforce, college readiness, or career pathways, use "Postsecondary Pathways" when the connection is strong enough.

Example no-alignment values:
"strategic_alignment": "-",
"alignment_explanation": "-",
"innovation_flag": false,
"innovation_reason": "N/A"'''


def patch_prompt_text(s):
    original=s
    if 'STRATEGIC ALIGNMENT FIELD' in s:
        s=re.sub(r'STRATEGIC ALIGNMENT FIELD.*?(?=\n\nLESLEY RECOMMENDATION DISPLAY FORMAT RULES:|\n\nRECOMMENDATION OUTPUT FORMAT:|\n\nReturn ONLY valid JSON|\n\nSTRICT OUTPUT REQUIREMENTS:)', build_v9_block(), s, flags=re.S)
    return s, s != original


def patch_obj(obj):
    changed=False
    if isinstance(obj,str):
        return patch_prompt_text(obj)
    if isinstance(obj,list):
        arr=[]
        for x in obj:
            nx,ch=patch_obj(x); changed=changed or ch; arr.append(nx)
        return arr,changed
    if isinstance(obj,dict):
        out={}
        for k,v in obj.items():
            nv,ch=patch_obj(v); changed=changed or ch; out[k]=nv
        return out,changed
    return obj,False


def patch_user_content(content):
    if not isinstance(content,str): return content, False
    if 'District context:' in content or 'district_id:' in content[:300]: return content, False
    if 'Analyze the following article content:' in content:
        new=content.replace('Analyze the following article content:\n\n', 'District context:\n- district_id: {{ $json.district_id || $json.meta?.district_id || $json.prepared?.district_id || "unknown" }}\n- source_query: {{ $json.source_query || $json.meta?.source_query || "" }}\n\nAnalyze the following article content:\n\n')
        return new, new!=content
    if 'District: {{ $json.source_query }}' in content:
        new=content.replace('District: {{ $json.source_query }} (ID: {{ $json.district_id }})', 'District context:\n- district_id: {{ $json.district_id || "unknown" }}\n- source_query: {{ $json.source_query || "" }}')
        return new, new!=content
    return content, False


def patch_ai_user_messages(node):
    params=node.get('parameters') or {}
    changed=False
    for key in ['responses','messages']:
        vals=(params.get(key) or {}).get('values') or []
        for v in vals:
            c=v.get('content')
            nc,ch=patch_user_content(c)
            if ch:
                v['content']=nc; changed=True
    return changed


def minimal_settings(wf):
    settings={}
    if isinstance(wf.get('settings'),dict):
        for k in ['executionOrder','timezone']:
            if wf['settings'].get(k): settings[k]=wf['settings'][k]
    settings.setdefault('executionOrder','v1')
    return settings


def main():
    load_env()
    ts=datetime.datetime.now(datetime.UTC).strftime('%Y%m%dT%H%M%SZ')
    backup_dir=Path('/tmp/canary_v9_client_priority_update')/ts
    backup_dir.mkdir(parents=True,exist_ok=True)
    for wid,name in TARGET_WORKFLOWS.items():
        wf=request('GET',f'/api/v1/workflows/{wid}')
        (backup_dir/f'{wid}_before.json').write_text(json.dumps(wf,indent=2,ensure_ascii=False))
        wf2=copy.deepcopy(wf)
        changes=[]
        for node in wf2.get('nodes',[]):
            raw=json.dumps(node.get('parameters',{}),ensure_ascii=False)
            if 'STRATEGIC ALIGNMENT FIELD' in raw:
                params,ch=patch_obj(node.get('parameters') or {})
                if ch:
                    node['parameters']=params; changes.append(node.get('name')+':prompt')
            if patch_ai_user_messages(node):
                changes.append(node.get('name')+':user_context')
        if changes:
            payload={'name':wf2['name'],'nodes':wf2['nodes'],'connections':wf2.get('connections') or {},'settings':minimal_settings(wf2)}
            request('PUT',f'/api/v1/workflows/{wid}',payload)
            verify=request('GET',f'/api/v1/workflows/{wid}')
            (backup_dir/f'{wid}_after.json').write_text(json.dumps(verify,indent=2,ensure_ascii=False))
            print(wid,name,'UPDATED',changes,'active',verify.get('active'))
        else:
            print(wid,name,'NO_CHANGES')
    print('backup_dir',backup_dir)

if __name__=='__main__': main()
