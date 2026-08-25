import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../src/app/actions.js', import.meta.url), 'utf8');

assert.match(page, /resolveDemoReviewerAccess/);
assert.match(page, /DEMO_REVIEWER_VIEWS = new Set\(\['dashboard', 'birdseye', 'social', 'articles', 'howto'\]\)/);
assert.match(page, /const dataDistrictId = isDemoReviewer[\s\S]*reviewerAccess\.selectedDistrictId/);
assert.match(page, /const dashboardUserDistrictId = isDemoReviewer \? null : userDistrictId/);
assert.match(page, /userDistrictId={dashboardUserDistrictId}/);
assert.match(page, /const districts = isDemoReviewer \? reviewerAccess\.districts : allDistricts/);
assert.match(page, /isDemoReviewer && requestedDistrictId !== reviewerAccess\.selectedDistrictId/);
assert.match(page, /melodiEnabled={!isDemoReviewer/);

assert.match(client, /!isDemoReviewer && <button[\s\S]*handleNavSelect\('queries'\)/);
assert.match(client, /!demoMode && !isDemoReviewer && \([\s\S]*Add \/ Correct Stories/);
assert.match(client, /!userDistrictId && !isDemoReviewer && \([\s\S]*sidebar-section-label">Admin/);
assert.match(client, /!demoMode && !isDemoReviewer && \([\s\S]*handleNavSelect\('settings'\)/);
assert.match(client, /if \(!noteModal \|\| isDemoReviewer\) return/);
assert.match(client, /function openExcludeModal\(article\) \{\s*if \(isDemoReviewer\) return/);
assert.match(client, /function handleEarnedMedia\(article, checked\) \{\s*if \(isDemoReviewer\) return/);
assert.match(client, /Demo preparation access:/);
assert.match(client, /districtId={userDistrictId \|\| \(isDemoReviewer \|\| demoMode \? districtFilter : ''\)}/);
assert.match(client, /!isDemoReviewer && <button className="feedback-btn"/);
assert.match(actions, /app_metadata\?\.role === 'demo_reviewer'[\s\S]*Demo preparation access is read-only/);

console.log('Dashboard demo-reviewer UI boundary checks passed.');
