#!/usr/bin/env python3
import datetime as dt
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

SEED_PATH = Path('data/strategic-priorities.seed.json')


def supabase_creds():
    candidate = ''
    for path in Path('/tmp/canary_v8_update').glob('*/*_after.json'):
        candidate += path.read_text(errors='ignore') + '\n'
    url = re.search(r'https://fehdonfrlsrrkzaemkxp\.supabase\.co', candidate).group(0)
    key = re.search(r'sb_secret_[A-Za-z0-9_\-]+', candidate).group(0)
    return url, key


def request(method, base, key, table, params=None, body=None, prefer=None):
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    url = f'{base}/rest/v1/{table}'
    if params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def main():
    base, key = supabase_creds()
    seed = json.loads(SEED_PATH.read_text())
    now = dt.datetime.now(dt.UTC).isoformat()
    profiles = []
    priorities_by_district = {}
    for district_id, profile in seed['profiles'].items():
        profiles.append({
            'district_id': district_id,
            'source_confidence': profile.get('source_confidence', 'needs_review'),
            'mission': profile.get('mission'),
            'vision': profile.get('vision'),
            'values': profile.get('values', []),
            'source_urls': profile.get('source_urls', []),
            'notes': f"Seeded from public-source research file {SEED_PATH.name}; version {seed.get('version')}",
            'last_reviewed_at': now,
            'reviewed_by': 'Hermes automated public-source seed',
        })
        priorities_by_district[district_id] = profile.get('priorities', [])

    # Upsert profiles and return IDs.
    returned = request(
        'POST', base, key, 'strategic_profiles',
        params={'on_conflict': 'district_id'},
        body=profiles,
        prefer='resolution=merge-duplicates,return=representation',
    )
    profile_id_by_district = {row['district_id']: row['id'] for row in returned}

    priorities = []
    for district_id, plist in priorities_by_district.items():
        profile_id = profile_id_by_district[district_id]
        profile_source_urls = next((p.get('source_urls', []) for p in seed['profiles'].values() if False), [])
        for p in plist:
            priorities.append({
                'district_id': district_id,
                'profile_id': profile_id,
                'label': p['label'],
                'description': p.get('description'),
                'aliases': p.get('aliases', []),
                'source_urls': p.get('source_urls') or seed['profiles'][district_id].get('source_urls', []),
                'confidence': p.get('confidence', 'needs_review'),
                'active': True,
            })

    returned_priorities = request(
        'POST', base, key, 'strategic_priorities',
        params={'on_conflict': 'district_id,label'},
        body=priorities,
        prefer='resolution=merge-duplicates,return=representation',
    )

    # Verify counts.
    profile_count = request('GET', base, key, 'strategic_profiles', params={'select': 'id', 'limit': '1000'})
    priority_count = request('GET', base, key, 'strategic_priorities', params={'select': 'id,district_id,label,active', 'limit': '1000'})
    print('seed_profiles_requested', len(profiles))
    print('seed_profiles_upserted_returned', len(returned))
    print('seed_priorities_requested', len(priorities))
    print('seed_priorities_upserted_returned', len(returned_priorities))
    print('db_profiles_count', len(profile_count))
    print('db_priorities_count', len(priority_count))
    by_district = {}
    for row in priority_count:
        by_district[row['district_id']] = by_district.get(row['district_id'], 0) + 1
    print('priorities_by_district', json.dumps(dict(sorted(by_district.items())), indent=2))


if __name__ == '__main__':
    main()
