import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260901201500_separate_source_ownership_and_earned_media.sql', import.meta.url), 'utf8');
const preUseRollback = await readFile(new URL('../supabase/rollbacks/20260901201500_separate_source_ownership_and_earned_media_pre_use.sql', import.meta.url), 'utf8');
const postUseRollback = await readFile(new URL('../supabase/rollbacks/20260901201500_separate_source_ownership_and_earned_media_post_use.sql', import.meta.url), 'utf8');
const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
const melodi = await readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists communications_earned boolean not null default false/);
assert.match(migration, /not communications_earned[\s\S]*is_earned_media is true[\s\S]*communications_earned_updated_at is not null[\s\S]*communications_earned_updated_by is not null/);
assert.match(migration, /'mark_earned', 'unmark_earned'/);
assert.match(migration, /canary_set_story_communications_earned\([\s\S]*p_expected_version integer/);
assert.match(migration, /before_row\.communications_earned = p_value[\s\S]*return before_row/);
assert.match(migration, /before_row\.correction_version <> p_expected_version/);
assert.match(migration, /correction_version = before_row\.correction_version \+ 1/);
assert.match(migration, /after_row\.correction_version/);
assert.match(migration, /for update/);
assert.match(migration, /Only External coverage can be marked as Earned Media/);
assert.match(migration, /Actor does not have access to this district/);
assert.match(migration, /coalesce\(actor_metadata->>'district_id', ''\)/);
assert.match(migration, /coalesce\(actor_metadata->>'role', ''\) = 'demo_reviewer'/);
assert.match(migration, /canary_guard_story_communications_earned_write/);
assert.match(migration, /Communications-earned state must be changed through the audited Canary RPC/);
assert.match(migration, /Unmark Earned Media before reclassifying External coverage as Owned/);
assert.match(migration, /insert into public\.story_correction_events/);
assert.match(migration, /revoke insert, update, delete on public\.story_correction_events from service_role/);
assert.doesNotMatch(migration, /set communications_earned\s*=\s*is_earned_media/i, 'External coverage must not be auto-migrated into Communications-earned');

assert.match(preUseRollback, /where action in \('mark_earned', 'unmark_earned'\)/);
assert.match(preUseRollback, /Pre-use rollback refused/);
assert.match(preUseRollback, /drop column if exists communications_earned/);
assert.match(preUseRollback, /check \(action in \('manual_add', 'exclude', 'restore'\)\)/);
assert.match(postUseRollback, /revoke execute on function public\.canary_set_story_communications_earned/);
assert.doesNotMatch(postUseRollback, /drop column|delete from public\.story_correction_events/i);

assert.match(data, /communications_earned/);
assert.match(actions, /export async function setEarnedMedia\(id, value, expectedVersion\)/);
assert.match(actions, /canary_set_story_communications_earned/);
assert.match(actions, /p_actor_user_id: actor\.id/);
assert.match(actions, /p_expected_version: normalizedVersion/);
assert.match(actions, /assertDistrictAccess\(actor, story\?\.district_id\)/);
assert.doesNotMatch(actions.slice(actions.indexOf('export async function setEarnedMedia'), actions.indexOf('export async function saveNote')), /update\(\{ is_earned_media:/);

assert.match(dashboard, /id: 'source_ownership',[\s\S]*?label: 'Source Ownership'/);
assert.match(dashboard, /id: 'earned_media',[\s\S]*?label: 'Earned Media'/);
assert.match(dashboard, /function isExternalCoverage\(article\)/);
assert.match(dashboard, /return Boolean\(article\.is_earned_media\)/);
assert.match(dashboard, /function isEarned\(article\)[\s\S]*?article\.communications_earned/);
assert.match(dashboard, /earnedVersionOverrides/);
assert.match(dashboard, /earnedSavingIds/);
assert.match(dashboard, /article\.correction_version \?\? 0/);
assert.match(dashboard, /savedRow\?\.correction_version/);
assert.match(dashboard, /disabled=\{!isExternalCoverage\(article\) \|\| earnedSavingIds\.has\(article\.id\)\}/);
assert.match(dashboard, /aria-label=\{`Mark \$\{article\.headline\} as Communications-earned coverage`\}/);
assert.match(dashboard, /Only External coverage can be marked as Earned Media/);
assert.match(dashboard, /<th>Source Ownership<InfoTooltip text=\{SOURCE_OWNERSHIP_TOOLTIP\} \/><\/th>/);
assert.match(dashboard, /<th>Earned Media<InfoTooltip text=\{EARNED_MEDIA_TOOLTIP\} \/><\/th>/);
assert.match(dashboard, /<div className="kpi-label">External Coverage<InfoTooltip text=\{SOURCE_OWNERSHIP_TOOLTIP\} \/><\/div>/);
assert.match(dashboard, /<div className="kpi-label">Earned Media<InfoTooltip text=\{EARNED_MEDIA_TOOLTIP\} \/><\/div>/);

assert.match(melodi, /source ownership=/);
assert.match(melodi, /communications earned=/);
assert.match(melodi, /communications_earned/);

assert.match(dashboard, /const \[sourceOwnershipFilter, setSourceOwnershipFilter\] = useState\('All'\)/);
assert.match(dashboard, /sourceOwnershipFilter === 'All'[\s\S]*?sourceOwnershipFilter === \(isExternalCoverage\(a\) \? 'External' : 'Owned'\)/);
assert.match(dashboard, /aria-label="Filter by source ownership"/);
assert.match(dashboard, /<option value="Owned">Owned<\/option>[\s\S]*?<option value="External">External<\/option>/);

console.log('Owned, External, and Communications-earned separation tests passed.');
