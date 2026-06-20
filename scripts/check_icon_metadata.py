#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
layout = (root / 'src/app/layout.js').read_text()
public_logo = root / 'public/canary-logo.png'
favicon = root / 'src/app/favicon.ico'

checks = {
    'favicon ico exists': favicon.exists() and favicon.stat().st_size > 0,
    'touch/icon source exists': public_logo.exists() and public_logo.stat().st_size > 0,
    'metadata declares icon': "url: '/favicon.ico'" in layout,
    'metadata declares apple touch icon': "apple: '/canary-logo.png'" in layout,
    'metadata declares png fallback': "url: '/canary-logo.png'" in layout,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('FAIL icon metadata checks:')
    for name in failed:
        print(f'- {name}')
    raise SystemExit(1)
print('PASS icon metadata checks')
