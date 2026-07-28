#!/usr/bin/env python3
import json, os, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
env=os.environ.copy()
for path in [Path('/opt/data/.env'), Path('/docker/hermes-agent-bsij/data/.env')]:
    if not path.exists(): continue
    for raw in path.read_text(errors='ignore').splitlines():
        value=raw.strip()
        if not value or value.startswith('#') or '=' not in value: continue
        key,item=value.split('=',1); item=item.strip()
        if len(item)>1 and item[0] in "\"'" and item[-1]==item[0]: item=item[1:-1]
        env[key.strip().replace('export ','')]=item
env['CANARY_HEALTH_STATE_FILE']='/opt/data/tmp/canary-health-state.json'
env['NEXT_PUBLIC_SUPABASE_URL']=env.get('CANARY_PROD_SUPABASE_URL', env.get('NEXT_PUBLIC_SUPABASE_URL', ''))
env['SUPABASE_SERVICE_ROLE_KEY']=env.get('CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY', env.get('SUPABASE_SERVICE_ROLE_KEY', ''))
env['CANARY_CLICKUP_API_TOKEN']=env.get('CANARY_CLICKUP_API_TOKEN', env.get('CLICKUP_API', ''))
env['CLICKUP_API_TOKEN']=env['CANARY_CLICKUP_API_TOKEN']
env['CANARY_CLICKUP_LIST_ID']=env.get('CANARY_CLICKUP_LIST_ID', '901710861265')
env['CLICKUP_LIST_ID']=env['CANARY_CLICKUP_LIST_ID']
sync_result=subprocess.run(['node','scripts/sync-feedback-to-clickup.mjs','--apply'],cwd=ROOT,env=env,text=True,capture_output=True,timeout=180)
result=subprocess.run(['node','scripts/check-canary-health.mjs','--quiet'],cwd=ROOT,env=env,text=True,capture_output=True,timeout=180)
if result.returncode:
    print('Canary health check failed: '+(result.stderr.strip() or f'exit {result.returncode}'))
    raise SystemExit(result.returncode)
if sync_result.returncode:
    print('Canary ClickUp retry worker failed: '+(sync_result.stderr.strip() or f'exit {sync_result.returncode}'))
if not result.stdout.strip(): raise SystemExit(sync_result.returncode)
report=json.loads(result.stdout)
alerts=report.get('alerts',[])
print(f"Canary collection health changed: {report.get('status','unknown').upper()} | {len(alerts)} alert(s)")
for alert in alerts[:12]:
    print(f"- {alert.get('severity','warning').upper()}: {alert.get('message','Unspecified alert')}")
if len(alerts)>12: print(f"- Plus {len(alerts)-12} additional alert(s).")
print('Workflow: https://eicagency.app.n8n.cloud/workflow/dVIf6KnZklHYzQvi')
raise SystemExit(sync_result.returncode)
