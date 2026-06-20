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

V8_BLOCK = '''STRATEGIC ALIGNMENT FIELD — V8 (stored for the live dashboard in legacy JSON keys innovation_flag and innovation_reason, while also returning explicit V8 keys strategic_alignment and alignment_explanation):
Review the content and determine whether it aligns with the district's stated mission, vision, values, strategic plan, goals, priorities, or beliefs provided during onboarding.

Only assign a Strategic Alignment when there is a strong and defensible connection to one or more district priorities. The connection should be clear enough that a district leader would reasonably agree with the assessment. If confidence is below 80%, do not assign an alignment.

If a clear connection exists, return:
- strategic_alignment: A concise strategic theme (2–4 words), such as Family Engagement, Student Success, School Safety, Community Partnerships, Innovation & Technology, Culture & Belonging, College & Career Readiness, Continuous Improvement, Student Well-Being, or Workforce Development.
- alignment_explanation: One concise sentence (15–30 words) explaining how the story supports or reflects the district's stated priorities.
- innovation_flag: true
- innovation_reason: The same alignment formatted for the current dashboard as **Alignment Title** – Alignment Explanation.

Do not force alignment. Routine operational updates, traffic notices, weather alerts, generic announcements, isolated events, or content with no meaningful connection to district priorities should receive a dash ("-") in strategic_alignment and alignment_explanation, with innovation_flag false and innovation_reason "N/A".

Example aligned values:
"strategic_alignment": "Family Engagement",
"alignment_explanation": "Expanding bilingual outreach strengthens school-home partnerships and improves access for families during key student transitions.",
"innovation_flag": true,
"innovation_reason": "**Family Engagement** – Expanding bilingual outreach strengthens school-home partnerships and improves access for families during key student transitions."

Example no-alignment values:
"strategic_alignment": "-",
"alignment_explanation": "-",
"innovation_flag": false,
"innovation_reason": "N/A"'''

HELPER = '''
  function buildStrategicAlignment(data) {
    const isBlank = (value) => {
      const v = String(value ?? '').trim();
      return !v || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(v);
    };
    const title = String(data.strategic_alignment ?? '').trim();
    const explanation = String(data.alignment_explanation ?? '').trim();
    const rawReason = String(data.innovation_reason ?? '').trim();
    if (!isBlank(title) && !isBlank(explanation)) {
      const cleanTitle = title.replace(/^\*\*|\*\*$/g, '').trim();
      return { flag: true, reason: `**${cleanTitle}** – ${explanation}` };
    }
    const legacyFlag = data.innovation_flag === true || data.innovation_flag === 'true';
    if (legacyFlag && !isBlank(rawReason)) return { flag: true, reason: rawReason };
    return { flag: false, reason: 'N/A' };
  }
  const strategicAlignment = buildStrategicAlignment(cleanJson);
'''


def load_env():
    for p in ['/opt/data/.env', '/docker/hermes-agent-bsij/.env', '/docker/hermes-agent-bsij/data/.env']:
        if Path(p).exists():
            for line in Path(p).read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def request(method, path, payload=None):
    base = os.environ['N8N_BASE_URL'].rstrip('/')
    key = os.environ.get('N8N_API') or os.environ.get('N8N_API_KEY')
    body = None if payload is None else json.dumps(payload).encode()
    headers = {'X-N8N-API-KEY': key, 'Accept': 'application/json'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors='replace')
        raise RuntimeError(f'{method} {path} failed {e.code}: {text[:2000]}')


def patch_prompt_text(s):
    original = s
    if 'STRATEGIC ALIGNMENT FIELD' in s:
        s = re.sub(
            r'STRATEGIC ALIGNMENT FIELD.*?(?=\n\nLESLEY RECOMMENDATION DISPLAY FORMAT RULES:|\n\nRECOMMENDATION OUTPUT FORMAT:|\n\nReturn ONLY valid JSON|\n\nSTRICT OUTPUT REQUIREMENTS:)',
            V8_BLOCK,
            s,
            flags=re.S,
        )
    elif 'innovation_reason' in s and 'local_recommendation' in s:
        marker = 'RECOMMENDATION OUTPUT FORMAT:' if 'RECOMMENDATION OUTPUT FORMAT:' in s else 'STRICT OUTPUT REQUIREMENTS:'
        s = s.replace(marker, V8_BLOCK + '\n\n' + marker)
    # Add explicit V8 keys to JSON schema examples when legacy key appears.
    if '"strategic_alignment"' not in s and '"innovation_reason"' in s:
        s = re.sub(
            r'("innovation_reason"\s*:\s*"[^"]*"\s*,)',
            r'\1\n  "strategic_alignment": "Family Engagement or -",\n  "alignment_explanation": "15-30 word explanation or -",',
            s,
            count=1,
        )
    return s, s != original


def patch_prompts(obj):
    changed = False
    if isinstance(obj, str):
        return patch_prompt_text(obj)
    if isinstance(obj, list):
        out = []
        for x in obj:
            nx, ch = patch_prompts(x)
            changed = changed or ch
            out.append(nx)
        return out, changed
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            nv, ch = patch_prompts(v)
            changed = changed or ch
            out[k] = nv
        return out, changed
    return obj, False


def patch_js(js):
    original = js
    if 'buildStrategicAlignment' not in js:
        if "const cleanJson = JSON.parse(aiRaw" in js:
            js = js.replace(
                "const cleanJson = JSON.parse(aiRaw.replace(/```json/g, '').replace(/```/g, '').trim());\n",
                "const cleanJson = JSON.parse(aiRaw.replace(/```json/g, '').replace(/```/g, '').trim());\n" + HELPER,
            )
        elif "cleanJson = JSON.parse(raw.replace" in js:
            js = js.replace(
                "  } catch(e) { return []; }\n",
                "  } catch(e) { return []; }\n" + HELPER,
            )
        elif "const cleanJson = aiText ? parseAiJson(aiText) : null;" in js:
            js = js.replace(
                "const cleanJson = aiText ? parseAiJson(aiText) : null;\n",
                "const cleanJson = aiText ? parseAiJson(aiText) : null;\n",
            )
            js = js.replace(
                "  const title = prepared.headline || meta.title || meta.headline || '';\n",
                HELPER + "\n  const title = prepared.headline || meta.title || meta.headline || '';\n",
            )
    js = js.replace(
        "innovation_flag:   cleanJson.innovation_flag === true || cleanJson.innovation_flag === 'true',\n      innovation_reason: cleanJson.innovation_reason,",
        "innovation_flag:   strategicAlignment.flag,\n      innovation_reason: strategicAlignment.reason,",
    )
    js = js.replace(
        "innovation_flag: cleanJson.innovation_flag === true || cleanJson.innovation_flag === 'true',\n      innovation_reason: cleanJson.innovation_reason,",
        "innovation_flag: strategicAlignment.flag,\n      innovation_reason: strategicAlignment.reason,",
    )
    js = js.replace(
        "const innovationRaw = String(cleanJson.innovation_reason || '').trim();",
        "const innovationRaw = strategicAlignment.reason;",
    )
    js = js.replace(
        "const innovationReason = String(cleanJson.innovation_reason || '').toLowerCase();\n    const innovation = cleanJson.innovation_flag === true || cleanJson.innovation_flag === 'true' ||",
        "const innovationReason = String(strategicAlignment.reason || '').toLowerCase();\n    const innovation = strategicAlignment.flag ||",
    )
    js = js.replace(
        "innovation_flag: cleanJson.innovation_flag === true || cleanJson.innovation_flag === 'true',\n    innovation_reason: sanitize(/^(n\\/?a|not applicable|none|null|undefined)$/i.test(innovationRaw) ? 'No innovation signal identified.' : innovationRaw),",
        "innovation_flag: strategicAlignment.flag,\n    innovation_reason: sanitize(/^(n\\/?a|not applicable|none|null|undefined|-)$/i.test(innovationRaw) ? 'N/A' : innovationRaw),",
    )
    return js, js != original


def minimal_settings(wf):
    settings = {}
    if isinstance(wf.get('settings'), dict):
        if wf['settings'].get('executionOrder'):
            settings['executionOrder'] = wf['settings']['executionOrder']
        if wf['settings'].get('timezone'):
            settings['timezone'] = wf['settings']['timezone']
    settings.setdefault('executionOrder', 'v1')
    return settings


def main():
    load_env()
    ts = datetime.datetime.now(datetime.UTC).strftime('%Y%m%dT%H%M%SZ')
    backup_dir = Path('/tmp/canary_v8_update') / ts
    backup_dir.mkdir(parents=True, exist_ok=True)
    changed_total = 0
    for wid, expected_name in TARGET_WORKFLOWS.items():
        status, wf = request('GET', f'/api/v1/workflows/{wid}')
        if wf.get('name') != expected_name:
            raise RuntimeError(f'{wid} expected {expected_name}, got {wf.get("name")}')
        (backup_dir / f'{wid}_before.json').write_text(json.dumps(wf, indent=2, ensure_ascii=False))
        wf2 = copy.deepcopy(wf)
        node_changes = []
        for node in wf2.get('nodes', []):
            params = node.get('parameters') or {}
            raw = json.dumps(params, ensure_ascii=False)
            if 'innovation_reason' in raw or 'STRATEGIC ALIGNMENT FIELD' in raw:
                new_params, ch = patch_prompts(params)
                if ch:
                    node['parameters'] = new_params
                    node_changes.append(node.get('name') + ':prompt')
            js = (node.get('parameters') or {}).get('jsCode')
            if js and 'innovation_reason' in js:
                new_js, ch = patch_js(js)
                if ch:
                    node['parameters']['jsCode'] = new_js
                    node_changes.append(node.get('name') + ':js')
        if not node_changes:
            print(wid, wf.get('name'), 'NO_CHANGES')
            continue
        payload = {
            'name': wf2['name'],
            'nodes': wf2['nodes'],
            'connections': wf2.get('connections') or {},
            'settings': minimal_settings(wf2),
        }
        status, updated = request('PUT', f'/api/v1/workflows/{wid}', payload)
        status, verify = request('GET', f'/api/v1/workflows/{wid}')
        (backup_dir / f'{wid}_after.json').write_text(json.dumps(verify, indent=2, ensure_ascii=False))
        if verify.get('active') != wf.get('active'):
            raise RuntimeError(f'{wf["name"]} active state changed from {wf.get("active")} to {verify.get("active")}')
        print(wid, wf.get('name'), 'UPDATED', ', '.join(node_changes), 'active', verify.get('active'))
        changed_total += 1
    print('backup_dir', backup_dir)
    print('workflows_changed', changed_total)


if __name__ == '__main__':
    main()
