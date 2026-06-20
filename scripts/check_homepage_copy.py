#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
page = (root / 'src/app/page.js').read_text()
css = (root / 'src/app/page.module.css').read_text()

required = {
    'approved hero headline': 'Know What Matters. Before Everyone Else Asks About It.' in page,
    'approved hero subtitle': 'daily review of the news and public social conversation that matters most' in page,
    'subtitle mentions sentiment summaries local context recommendations': all(s in page for s in ['sentiment', 'summaries', 'local context', 'strategic recommendations']),
    'homepage sentiment examples use score + label': all(s in page for s in ['Score: 3.9', 'Concerning', 'Score: 5.6', 'Neutral', 'Score: 8.8', 'Positive']),
    'old hero headline removed': 'See everything said about your district. Once a day.' not in page,
    'risk badges replaced with sentiment score badges': 'High Risk' not in page and '>High<' not in page and '>Low<' not in page and 'riskHigh' not in page and 'riskLow' not in page,
    'score badge styles exist': all(s in css for s in ['scoreConcerning', 'scoreNeutral', 'scorePositive']),
    'demo section uses buyer-facing badge': 'See It in Action' in page and 'Sales Demo Ready' not in page,
    'homepage preview metrics match visible dashboard KPIs': all(s in page for s in ['Total Mentions', 'Avg. Sentiment Score', 'Top Source', 'Notes Added']) and all(s not in page for s in ['High Risk', 'Concerning Items', 'Earned Stories']),
}

failed = [name for name, ok in required.items() if not ok]
if failed:
    print('FAIL homepage copy checks:')
    for name in failed:
        print(f'- {name}')
    raise SystemExit(1)
print('PASS homepage copy checks')
