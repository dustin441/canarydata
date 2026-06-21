#!/usr/bin/env python3
import copy, datetime, json, os, re, urllib.request
from pathlib import Path

TARGETS = {
    'F4G5VdrDBAO56Kzr': {'name': 'Canary Data - Media Monitor Template', 'from': 'District Geo Validation', 'ai': 'AI Analysis1'},
    'CtcTdZJbhx5I7c1M': {'name': 'Canary Data - Social Monitor', 'from': 'Pre-Filter Districts', 'ai': 'AI Analysis'},
    '6hYuq91xhEYKlHnD': {'name': 'Canary Data - Media Monitor Backfill (12mo)', 'from': 'Filter1', 'ai': 'AI Analysis1'},
    'dVIf6KnZklHYzQvi': {'name': 'Canary Data - Live Ingestion with Geo Validation', 'from': 'Format for AI', 'ai': 'AI Analysis1'},
}
SUPABASE_URL = 'https://fehdonfrlsrrkzaemkxp.supabase.co'
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('CANARY_SUPABASE_SERVICE_ROLE_KEY')
if not SUPABASE_KEY:
    raise RuntimeError('Set SUPABASE_SERVICE_ROLE_KEY in the runtime environment; do not hardcode it in scripts.')
NODE_NAME = 'Attach DB Strategic Priorities'


def load_env():
    for p in ['/opt/data/.env','/docker/hermes-agent-bsij/.env','/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1); os.environ.setdefault(k,v.strip().strip('"').strip("'"))


def req(method,path,payload=None):
    base=os.environ['N8N_BASE_URL'].rstrip('/'); key=os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    data=None if payload is None else json.dumps(payload).encode()
    h={'X-N8N-API-KEY':key,'Accept':'application/json'}
    if payload is not None: h['Content-Type']='application/json'
    r=urllib.request.Request(base+path,data=data,headers=h,method=method)
    with urllib.request.urlopen(r,timeout=90) as resp:
        raw=resp.read().decode(); return json.loads(raw) if raw else None


def minimal_settings(wf):
    settings={}
    if isinstance(wf.get('settings'),dict):
        for k in ['executionOrder','timezone']:
            if wf['settings'].get(k): settings[k]=wf['settings'][k]
    settings.setdefault('executionOrder','v1')
    return settings


def attach_js():
    return f"""
const SUPABASE_URL = '{SUPABASE_URL}';
const SUPABASE_KEY = '{SUPABASE_KEY}';

function districtIdFor(json) {{
  return json.district_id || json.meta?.district_id || json.prepared?.district_id || json.source?.district_id || 'unknown';
}}

async function getJson(url) {{
  const res = await fetch(url, {{
    headers: {{ apikey: SUPABASE_KEY, Authorization: `Bearer ${{SUPABASE_KEY}}`, Accept: 'application/json' }},
  }});
  if (!res.ok) throw new Error(`Strategic priority lookup failed ${{res.status}}: ${{await res.text()}}`);
  return await res.json();
}}

const cache = new Map();
const out = [];
for (const item of $input.all()) {{
  const district_id = districtIdFor(item.json || {{}});
  if (!cache.has(district_id)) {{
    const profileUrl = `${{SUPABASE_URL}}/rest/v1/strategic_profiles?select=district_id,source_confidence,mission,vision,source_urls,notes&district_id=eq.${{encodeURIComponent(district_id)}}&limit=1`;
    const priorityUrl = `${{SUPABASE_URL}}/rest/v1/strategic_priorities?select=label,description,aliases,confidence,source_urls&active=eq.true&district_id=eq.${{encodeURIComponent(district_id)}}&order=label.asc`;
    const [profiles, priorities] = await Promise.all([getJson(profileUrl), getJson(priorityUrl)]);
    cache.set(district_id, {{ profile: profiles[0] || null, priorities }});
  }}
  const data = cache.get(district_id);
  item.json.strategic_priority_profile = {{
    district_id,
    source: 'supabase.strategic_profiles/strategic_priorities',
    profile: data.profile,
    priorities: data.priorities,
  }};
  out.push(item);
}}
return out;
""".strip()


def add_or_update_node(wf, from_name, ai_name):
    nodes=wf['nodes']; con=wf['connections']
    from_node=next(n for n in nodes if n['name']==from_name)
    ai_node=next(n for n in nodes if n['name']==ai_name)
    existing=next((n for n in nodes if n['name']==NODE_NAME),None)
    new_node={
        'parameters': {'jsCode': attach_js()},
        'id': existing.get('id') if existing else re.sub('[^a-zA-Z0-9]','',NODE_NAME)[:16]+datetime.datetime.now(datetime.UTC).strftime('%H%M%S'),
        'name': NODE_NAME,
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': [int((from_node['position'][0]+ai_node['position'][0])/2), from_node['position'][1]],
    }
    if existing:
        existing.update(new_node)
    else:
        nodes.append(new_node)
    # Replace from -> ai with from -> attach, attach -> ai.
    from_outputs = con.get(from_name, {}).get('main', [])
    replaced=False
    for output in from_outputs:
        for target in output:
            if target.get('node') == ai_name:
                target['node'] = NODE_NAME
                replaced=True
    if not replaced:
        # If already wired, leave from->attach in place or add it to first output.
        if not from_outputs:
            con.setdefault(from_name, {})['main'] = [[]]
            from_outputs = con[from_name]['main']
        if not any(t.get('node')==NODE_NAME for out in from_outputs for t in out):
            from_outputs[0].append({'node': NODE_NAME, 'type': 'main', 'index': 0})
    con[NODE_NAME] = {'main': [[{'node': ai_name, 'type': 'main', 'index': 0}]]}


def patch_prompts(obj):
    changed=False
    if isinstance(obj,str):
        s=obj
        if 'STRATEGIC_PRIORITY_PROFILES:' in s:
            # Replace the huge embedded profiles section with DB-backed instructions.
            s=re.sub(r'\nSTRATEGIC_PRIORITY_PROFILES:\n\{.*?\}\n\nExample with provided profile:', '\nDB_STRATEGIC_PRIORITY_PROFILE:\nUse the JSON object supplied in the user message under strategic_priority_profile. It is loaded from Supabase tables strategic_profiles and strategic_priorities immediately before analysis.\n\nExample with provided profile:', s, flags=re.S)
        if 'Priority source of truth:' in s and 'Use the DB_STRATEGIC_PRIORITY_PROFILE' not in s:
            s=s.replace('- Use the STRATEGIC_PRIORITY_PROFILES JSON below when the current district_id is present.', '- Use the DB_STRATEGIC_PRIORITY_PROFILE JSON supplied in the user message when priorities are present.')
            s=s.replace('STRATEGIC_PRIORITY_PROFILES for this district_id', 'DB_STRATEGIC_PRIORITY_PROFILE for this district_id')
        return s, s!=obj
    if isinstance(obj,list):
        arr=[]
        for x in obj:
            nx,ch=patch_prompts(x); changed|=ch; arr.append(nx)
        return arr,changed
    if isinstance(obj,dict):
        d={}
        for k,v in obj.items():
            nv,ch=patch_prompts(v); changed|=ch; d[k]=nv
        return d,changed
    return obj,False


def patch_user_message_content(content):
    if not isinstance(content,str): return content, False
    marker='Strategic priority profile JSON:\n{{ JSON.stringify($json.strategic_priority_profile || {}) }}\n\n'
    if 'Strategic priority profile JSON:' in content: return content, False
    if 'Analyze the following article content:' in content:
        return content.replace('Analyze the following article content:', marker+'Analyze the following article content:'), True
    if 'Content:\n{{ $json.data }}' in content:
        return content.replace('Content:\n{{ $json.data }}', marker+'Content:\n{{ $json.data }}'), True
    return content, False


def patch_ai_user_message(wf):
    changed=False
    for node in wf['nodes']:
        if node.get('type','').endswith('.openAi') or node.get('type','').endswith('.anthropic') or 'langchain' in node.get('type',''):
            params=node.get('parameters') or {}
            for key in ['responses','messages']:
                vals=(params.get(key) or {}).get('values') or []
                for msg in vals:
                    nc,ch=patch_user_message_content(msg.get('content'))
                    if ch:
                        msg['content']=nc; changed=True
            np,ch=patch_prompts(params)
            if ch:
                node['parameters']=np; changed=True
    return changed


def main():
    load_env()
    ts=datetime.datetime.now(datetime.UTC).strftime('%Y%m%dT%H%M%SZ')
    backup=Path('/tmp/canary_v10_db_priority_update')/ts; backup.mkdir(parents=True,exist_ok=True)
    for wid,cfg in TARGETS.items():
        wf=req('GET',f'/api/v1/workflows/{wid}')
        (backup/f'{wid}_before.json').write_text(json.dumps(wf,indent=2,ensure_ascii=False))
        wf2=copy.deepcopy(wf)
        add_or_update_node(wf2,cfg['from'],cfg['ai'])
        patch_ai_user_message(wf2)
        payload={'name':wf2['name'],'nodes':wf2['nodes'],'connections':wf2.get('connections') or {},'settings':minimal_settings(wf2)}
        req('PUT',f'/api/v1/workflows/{wid}',payload)
        verify=req('GET',f'/api/v1/workflows/{wid}')
        (backup/f'{wid}_after.json').write_text(json.dumps(verify,indent=2,ensure_ascii=False))
        print(wid,cfg['name'],'UPDATED','active',verify.get('active'))
    print('backup_dir',backup)

if __name__=='__main__': main()
