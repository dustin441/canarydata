#!/usr/bin/env python3
import json
import os
import urllib.request
from pathlib import Path

TARGET_WORKFLOWS = {
    'F4G5VdrDBAO56Kzr': 'Canary Data - Media Monitor Template',
    'CtcTdZJbhx5I7c1M': 'Canary Data - Social Monitor',
    '6hYuq91xhEYKlHnD': 'Canary Data - Media Monitor Backfill (12mo)',
    'dVIf6KnZklHYzQvi': 'Canary Data - Live Ingestion with Geo Validation',
}


def load_env():
    for p in ['/opt/data/.env', '/docker/hermes-agent-bsij/.env', '/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def get_workflow(wid):
    base = os.environ['N8N_BASE_URL'].rstrip('/')
    key = os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    req = urllib.request.Request(
        f'{base}/api/v1/workflows/{wid}',
        headers={'X-N8N-API-KEY': key, 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def all_text(obj):
    return json.dumps(obj, ensure_ascii=False)


def ai_prompt_text(wf):
    chunks = []
    for node in wf.get('nodes', []):
        ntype = node.get('type', '')
        if 'langchain' not in ntype.lower() and 'openai' not in ntype.lower() and 'anthropic' not in ntype.lower():
            continue
        chunks.append(all_text(node.get('parameters', {})))
    return '\n'.join(chunks)


def code_text(wf):
    return '\n'.join(
        (node.get('parameters') or {}).get('jsCode', '')
        for node in wf.get('nodes', [])
        if (node.get('parameters') or {}).get('jsCode')
    )


def main():
    load_env()
    failures = []
    for wid, expected_name in TARGET_WORKFLOWS.items():
        wf = get_workflow(wid)
        prompt = ai_prompt_text(wf)
        code = code_text(wf)
        checks = {
            'expected workflow name': wf.get('name') == expected_name,
            'V9 client-specific logic': 'V9 CLIENT-SPECIFIC PRIORITY MATCHING' in prompt,
            'priority source of truth embedded': 'STRATEGIC_PRIORITY_PROFILES' in prompt and 'chiefs-for-change' in prompt,
            'exact label rule': 'output the exact provided priority label' in prompt,
            'generic-label ban': 'Do not output generic labels unless that exact label exists' in prompt,
            'C4C Postsecondary Pathways rule': 'Postsecondary Pathways' in prompt and 'not to a generic college/career label' in prompt,
            'low/no-profile no guessing rule': 'no profile or the profile is low confidence' in prompt,
            '80 percent threshold': 'confidence is below 80%' in prompt,
            'district context in user prompt': 'district_id:' in prompt and 'source_query:' in prompt,
            'legacy compatibility retained': 'innovation_flag' in prompt and 'innovation_reason' in prompt,
            'code maps output into visible Strategic Alignment': 'buildStrategicAlignment' in code and 'strategicAlignment.reason' in code,
            'workflow active state is safe': wf.get('active') is (False if wid == '6hYuq91xhEYKlHnD' else True),
        }
        for name, ok in checks.items():
            if not ok:
                failures.append(f'{expected_name}: {name}')
    if failures:
        print('FAIL V9 client-specific Strategic Alignment checks:')
        for f in failures:
            print('-', f)
        raise SystemExit(1)
    print('PASS V9 client-specific Strategic Alignment checks')


if __name__ == '__main__':
    main()
