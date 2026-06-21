#!/usr/bin/env python3
"""Execute SQL against Canary Supabase via n8n's stored Postgres credential.

Creates a temporary webhook workflow: Webhook -> Postgres executeQuery -> Respond.
This avoids needing the raw database password in the shell.
"""
import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

CRED_ID = '08FLqGwkHOBRkypq'
CRED_NAME = 'Postgres account 3'


def load_env():
    for p in ['/opt/data/.env','/docker/hermes-agent-bsij/.env','/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def n8n(method, path, body=None):
    base=os.environ['N8N_BASE_URL'].rstrip('/')
    key=os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    data=None if body is None else json.dumps(body).encode()
    headers={'X-N8N-API-KEY':key,'Accept':'application/json'}
    if body is not None:
        headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,data=data,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as r:
        raw=r.read().decode()
        return json.loads(raw) if raw else None


def http_post_json(url, body):
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Accept':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=120) as r:
        raw=r.read().decode()
        try: return json.loads(raw)
        except Exception: return raw


def create_workflow(path):
    return {
        'name': 'TEMP Canary SQL Executor - delete me',
        'nodes': [
            {
                'parameters': {'httpMethod':'POST','path':path,'responseMode':'responseNode','options':{}},
                'id':'webhook','name':'Webhook','type':'n8n-nodes-base.webhook','typeVersion':2.1,'position':[0,0]
            },
            {
                'parameters': {
                    'operation':'executeQuery',
                    'query':'={{ $json.body.sql }}',
                    'options': {}
                },
                'id':'postgres','name':'Execute SQL','type':'n8n-nodes-base.postgres','typeVersion':2.6,'position':[220,0],
                'credentials': {'postgres': {'id': CRED_ID, 'name': CRED_NAME}}
            },
            {
                'parameters': {'respondWith':'json','responseBody':'={{ { ok: true, rows: $input.all().map(i => i.json) } }}','options':{}},
                'id':'respond','name':'Respond','type':'n8n-nodes-base.respondToWebhook','typeVersion':1.4,'position':[440,0]
            }
        ],
        'connections': {
            'Webhook': {'main': [[{'node':'Execute SQL','type':'main','index':0}]]},
            'Execute SQL': {'main': [[{'node':'Respond','type':'main','index':0}]]},
        },
        'settings': {'executionOrder':'v1'}
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--sql', help='SQL string')
    ap.add_argument('--file', help='File containing SQL')
    ap.add_argument('--keep', action='store_true')
    args=ap.parse_args()
    load_env()
    sql=args.sql or Path(args.file).read_text()
    path='temp-canary-sql-' + str(int(time.time()))
    wf=n8n('POST','/api/v1/workflows',create_workflow(path))
    wid=wf['id']
    try:
        n8n('POST',f'/api/v1/workflows/{wid}/activate')
        time.sleep(1.5)
        url=os.environ['N8N_BASE_URL'].rstrip() + '/webhook/' + path
        out=http_post_json(url, {'sql': sql})
        print(json.dumps({'workflow_id':wid,'webhook':url,'result':out},indent=2,ensure_ascii=False))
    finally:
        if not args.keep:
            try: n8n('POST',f'/api/v1/workflows/{wid}/deactivate')
            except Exception: pass
            try: n8n('DELETE',f'/api/v1/workflows/{wid}')
            except Exception: pass


if __name__=='__main__': main()
