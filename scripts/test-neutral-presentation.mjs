import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');

assert.match(styles, /--neutral-500:\s*#60A5FA/i);
assert.match(styles, /--neutral-bg:\s*rgba\(96,\s*165,\s*250,\s*0\.1[24]\)/i);
assert.match(styles, /\.score-badge\.medium\s*\{[^}]*background:\s*var\(--neutral-bg\)[^}]*color:\s*var\(--neutral-500\)/is);
assert.doesNotMatch(styles, /\.score-badge\.medium\s*\{[^}]*orange/is);
assert.match(dashboard, /if \(nScore >= 3\) fillColor = '#60A5FA'/);
assert.match(dashboard, /stroke="#60A5FA"[^>]*zoneStroke\(3, 7\)/);
assert.match(dashboard, /fill="#60A5FA"[^>]*>Neutral<\/text>/);

console.log('Neutral sentiment presentation checks passed.');
