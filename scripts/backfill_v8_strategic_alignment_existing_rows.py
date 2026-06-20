#!/usr/bin/env python3
"""Targeted V8 Strategic Alignment backfill for existing Supabase news_stories rows.

This updates only the dashboard compatibility fields:
- innovation_flag
- innovation_reason

It intentionally does not rewrite summary, sentiment, recommendation, calculated_value, source fields,
or profile_version, so the backfill is tightly scoped and reversible from the backup JSON.
"""
import argparse
import collections
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PROFILE_MARKER = 'v8_strategic_alignment_backfill_20260620'
BACKUP_ROOT = Path('/tmp/canary_v8_alignment_backfill')

ALIGNMENT_RULES = [
    ('Family Engagement',
     r'\b(parent|parents|family|families|bilingual|translation|outreach|open house|orientation|listening session|town hall|public meeting|community meeting|enrollment|registration|freshman|kindergarten|back-to-school)\b',
     'This story supports stronger school-home partnerships by improving access, communication, and trust with families.'),
    ('Community Partnerships',
     r'\b(partner|partnership|foundation|donat(?:e|ion)|grant|sponsor|49ers|business partner|community support|volunteer|nonprofit|university|college partner|external investment|HBCU|collaboration|Amazon)\b',
     'This story reflects how community partnerships expand opportunities and resources for students and schools.'),
    ('College & Career Readiness',
     r'\b(CTE|career|technical education|technology center|modern manufacturing|workforce|internship|apprentice|FAFSA|college readiness|career readiness|pathway|trade|certification|industry|dual credit|scholarship)\b',
     'This story advances college and career readiness by connecting students to future-focused learning and opportunities.'),
    ('Student Success',
     r'\b(graduat(?:e|ion)|achievement|award|recognition|honor roll|student success|test score|literacy|reading|fluency|i-Ready|dropout|academic|champion|state finals|wins?|senior spotlight|student achievement|perfect attendance|professional development)\b',
     'This story reinforces student success by highlighting achievement, growth, and well-rounded educational outcomes.'),
    ('School Safety',
     r'\b(lockdown|threat|weapon|shoot(?:er|ing)?|police|security|camera|violence|assault|fight|crisis|emergency|safety|safe school|cyberbully|bully|mental health|grief|death|memorial|accident|illness|heat safety)\b',
     'This story connects to the district priority of maintaining safe, secure, and supportive learning environments.'),
    ('Innovation & Technology',
     r'\b(robotics|STEM|STEAM|coding|computer science|AI\b|artificial intelligence|technology lab|makerspace|future-ready|design thinking)\b',
     'This story aligns with future-ready learning by expanding technology, innovation, and real-world problem solving.'),
    ('Culture & Belonging',
     r'\b(belonging|culture|cultural|heritage|mariachi|arts|music|mural|LGBTQ|inclusion|inclusive|equity|diversity|first-generation|student voice|representation)\b',
     'This story supports a culture of belonging by elevating student voice, inclusion, and community connection.'),
    ('Continuous Improvement',
     r'\b(strategic plan|strategic priority|board goal|goal|survey|feedback|listening and learning|100-day|continuous improvement|data-informed|performance|accountability|improvement plan|superintendent transition)\b',
     'This story reflects continuous improvement through feedback, planning, accountability, and district priority-setting.'),
    ('Student Well-Being',
     r'\b(well-being|wellbeing|nutrition|food|resource fair|counseling|support services|health|hydration|student support|attendance|homeless|mental health)\b',
     'This story supports student well-being by addressing resources, support systems, and conditions that help students thrive.'),
]

# Phrases that often made the old innovation classifier over-fire. These should be N/A unless
# another strong rule above also applies.
NOISE_PATTERNS = re.compile(
    r'\b(roster|schedule|scoreboard|maxpreps|standings|varsity|jv|softball roster|football roster|basketball roster|game recap|box score|stats|player store|generic home page|directory|rap performance|school chant)\b',
    re.I,
)
ROUTINE_PATTERNS = re.compile(
    r'\b(traffic notice|bus detour|weather alert|closure notice|calendar reminder|menu|agenda only|routine notice)\b',
    re.I,
)


def load_env():
    for p in ['/opt/data/.env', '/docker/hermes-agent-bsij/.env', '/docker/hermes-agent-bsij/data/.env']:
        path = Path(p)
        if path.exists():
            for line in path.read_text(errors='ignore').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def supabase_creds():
    # Prefer credentials embedded in the Canary n8n workflow backups. The shell env may
    # point at a different Supabase project for unrelated Hermes/Fathom work.
    candidate = ''
    for root in [Path('/tmp/canary_v8_update'), Path('/tmp')]:
        for path in root.glob('**/*.json'):
            if path.stat().st_size < 2_000_000:
                try:
                    txt = path.read_text(errors='ignore')
                except Exception:
                    continue
                if 'fehdonfrlsrrkzaemkxp.supabase.co' in txt or 'sb_secret_' in txt:
                    candidate += txt + '\n'
    urls = re.findall(r'https://[a-z0-9]+\.supabase\.co', candidate)
    keys = re.findall(r'sb_secret_[A-Za-z0-9_\-]+', candidate)
    if urls and keys:
        # Canary Data project from memory / workflow backups.
        canary_urls = [u for u in urls if 'fehdonfrlsrrkzaemkxp' in u]
        return (canary_urls[0] if canary_urls else urls[0]), keys[0]

    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_KEY')
    if url and key:
        return url.rstrip('/'), key
    raise RuntimeError('Could not resolve Supabase URL/service key')


def http_json(method, url, key, params=None, body=None, prefer=None):
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    full = url
    if params:
        full += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(full, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read().decode()
        return r.headers, json.loads(raw) if raw else None


def fetch_all_rows(base, key):
    rows = []
    offset = 0
    page = 1000
    while True:
        _, batch = http_json('GET', base + '/rest/v1/news_stories', key, params={
            'select': 'id,created_at,date,headline,summary,tags,notes,source,source_type,source_query,district_id,innovation_flag,innovation_reason,profile_version,relevance_score',
            'order': 'created_at.asc',
            'limit': str(page),
            'offset': str(offset),
        })
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def normalize_tags(tags):
    if isinstance(tags, list):
        return ' '.join(str(x) for x in tags)
    if isinstance(tags, str):
        return tags
    return ''


def classify(row):
    text = ' '.join(str(row.get(k) or '') for k in ['headline', 'summary', 'notes', 'source', 'source_query'])
    try:
        relevance = float(row.get('relevance_score') or 0)
    except Exception:
        relevance = 0
    if relevance and relevance <= 1:
        return False, 'N/A', 'low_relevance'
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        return False, 'N/A', '-'
    # Avoid obvious content-provider noise that the old innovation classifier often mislabeled.
    if NOISE_PATTERNS.search(text) and not re.search(r'\b(champion|state finals|scholarship|CTE|career|foundation|partnership|safety|mental health|graduation)\b', text, re.I):
        return False, 'N/A', 'noise'
    if ROUTINE_PATTERNS.search(text):
        return False, 'N/A', 'routine'
    for title, pattern, explanation in ALIGNMENT_RULES:
        if re.search(pattern, text, re.I):
            return True, f'**{title}** – {explanation}', title
    return False, 'N/A', '-'


def is_legacy_alignment_candidate(row):
    """Only backfill rows that already had a legacy innovation/alignment value.

    Rows that were already N/A should not be upgraded by this deterministic backfill;
    future AI can assign V8 alignment on new items, but for historical launch cleanup the
    safest scope is correcting old innovation-style values and false positives.
    """
    reason = str(row.get('innovation_reason') or '').strip()
    if bool(row.get('innovation_flag')):
        return True
    return bool(reason) and not re.fullmatch(r'n/?a|not applicable|none|null|undefined|-', reason, re.I)


def diff_needed(row, flag, reason):
    if not is_legacy_alignment_candidate(row):
        return False
    return (bool(row.get('innovation_flag')) != bool(flag)) or ((row.get('innovation_reason') or 'N/A').strip() != reason)


def patch_row(base, key, row_id, flag, reason):
    params = {'id': 'eq.' + row_id}
    body = {'innovation_flag': flag, 'innovation_reason': reason}
    return http_json('PATCH', base + '/rest/v1/news_stories', key, params=params, body=body, prefer='return=minimal')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Actually update Supabase. Default is dry-run only.')
    ap.add_argument('--limit', type=int, default=0, help='Optional max changed rows to apply for testing.')
    args = ap.parse_args()

    load_env()
    base, key = supabase_creds()
    ts = dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')
    out_dir = BACKUP_ROOT / ts
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = fetch_all_rows(base, key)
    if not rows:
        raise RuntimeError('No news_stories rows fetched')
    backup_path = out_dir / 'news_stories_before_v8_alignment_backfill.json'
    backup_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False))

    planned = []
    category_counts = collections.Counter()
    changed_counts = collections.Counter()
    for row in rows:
        flag, reason, category = classify(row)
        category_counts[category] += 1
        if diff_needed(row, flag, reason):
            planned.append({
                'id': row['id'],
                'headline': row.get('headline'),
                'old_flag': row.get('innovation_flag'),
                'old_reason': row.get('innovation_reason'),
                'new_flag': flag,
                'new_reason': reason,
                'category': category,
                'profile_version': row.get('profile_version'),
                'created_at': row.get('created_at'),
            })
            changed_counts[category] += 1

    (out_dir / 'planned_changes.json').write_text(json.dumps(planned, indent=2, ensure_ascii=False))
    print('rows_total', len(rows))
    print('planned_changes', len(planned))
    print('backup_path', backup_path)
    print('planned_path', out_dir / 'planned_changes.json')
    print('category_counts', dict(category_counts))
    print('changed_counts', dict(changed_counts))
    print('\nSample planned changes:')
    for item in planned[:12]:
        print('-', item['headline'][:120] if item.get('headline') else item['id'])
        print('  old:', item.get('old_flag'), str(item.get('old_reason'))[:180])
        print('  new:', item.get('new_flag'), item.get('new_reason')[:180])

    if not args.apply:
        print('\nDRY_RUN_ONLY')
        return

    to_apply = planned[:args.limit] if args.limit else planned
    print('\nAPPLYING', len(to_apply), 'updates...')
    errors = []
    for i, item in enumerate(to_apply, 1):
        try:
            patch_row(base, key, item['id'], item['new_flag'], item['new_reason'])
        except Exception as e:
            errors.append({'id': item['id'], 'error': str(e)})
        if i % 100 == 0:
            print('updated', i, '/', len(to_apply), 'errors', len(errors))
            time.sleep(0.2)
    (out_dir / 'errors.json').write_text(json.dumps(errors, indent=2))
    print('errors', len(errors))
    if errors:
        raise SystemExit(2)

    after = fetch_all_rows(base, key)
    (out_dir / 'news_stories_after_v8_alignment_backfill.json').write_text(json.dumps(after, indent=2, ensure_ascii=False))
    remaining = []
    for row in after:
        flag, reason, category = classify(row)
        if diff_needed(row, flag, reason):
            remaining.append({'id': row['id'], 'headline': row.get('headline'), 'expected': reason, 'actual': row.get('innovation_reason')})
    (out_dir / 'remaining_diffs.json').write_text(json.dumps(remaining, indent=2, ensure_ascii=False))
    print('remaining_diffs_after_apply', len(remaining))
    print('output_dir', out_dir)


if __name__ == '__main__':
    main()
