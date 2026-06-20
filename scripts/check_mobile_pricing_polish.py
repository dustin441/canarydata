#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
client = (root / 'src/app/dashboard/DashboardClient.js').read_text()
css = (root / 'src/app/globals.css').read_text()

checks = {
    'mobile sidebar close button has accessible label': 'Close navigation menu' in client,
    'sidebar nav uses a close-on-select helper': 'handleNavSelect' in client and 'setSidebarOpen(false)' in client,
    'mobile sidebar scrim exists for tap-away close': 'sidebar-scrim' in client and '.sidebar-scrim' in css,
    'topbar keeps a compact mobile notify CTA': 'release-cta-mobile' in client and 'Notify Me' in client,
    'pricing is treated as a journey/value card': 'pricing-journey-card' in client and 'Early adopter launch offer' in client,
    'pricing modal uses structured value bullets': 'release-pricing-card' in client and 'Built for school communicators' in client,
    'small-screen modal/CTA CSS exists': '@media (max-width: 768px)' in css and '.release-cta-mobile' in css and '.release-pricing-card' in css,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('FAIL mobile/pricing polish checks:')
    for name in failed:
        print(f'- {name}')
    raise SystemExit(1)

print('PASS mobile/pricing polish checks')
