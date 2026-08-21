const FORBIDDEN_ORGANIZATION = /(?:\beic\b|good[ -]?game|infinite[ -]?heart)/i;
const SCHOOL_OR_DISTRICT = /(?:school|district)/i;

function parseTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function validateRosterManifest(manifest) {
  if (!manifest || manifest.organization_boundary !== "canary_only") {
    throw new Error("Roster must declare organization_boundary=canary_only");
  }
  if (manifest.scope !== "active_paid_and_trial_school_districts") {
    throw new Error("Roster scope must be active_paid_and_trial_school_districts");
  }
  if (
    manifest.rules?.allowlist_only !== true ||
    manifest.rules?.exclude_test_demo_and_admin !== true ||
    manifest.rules?.reject_unknown_organizations !== true ||
    manifest.rules?.eic_and_eic_clients_are_out_of_scope !== true
  ) {
    throw new Error("Roster isolation rules are incomplete");
  }

  const districts = manifest.districts || {};
  const entries = Object.entries(districts);
  if (!entries.length) throw new Error("Roster contains no districts");

  const names = new Set();
  for (const [districtId, config] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(districtId)) {
      throw new Error(`Invalid district id: ${districtId}`);
    }
    if (/(?:^|-)(?:test|demo)(?:-|$)/i.test(districtId)) {
      throw new Error(`Test/demo district is forbidden: ${districtId}`);
    }
    const name = String(config?.name || "").trim();
    if (!name || !SCHOOL_OR_DISTRICT.test(name)) {
      throw new Error(`Roster organization is not a school district: ${districtId}`);
    }
    if (FORBIDDEN_ORGANIZATION.test(`${districtId} ${name}`)) {
      throw new Error(`EIC or EIC-client organization is forbidden: ${districtId}`);
    }
    if (!new Set(["paid", "trial", "complimentary"]).has(config?.type)) {
      throw new Error(`District ${districtId} must be paid, trial, or complimentary`);
    }
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) throw new Error(`Duplicate district name: ${name}`);
    names.add(normalizedName);
  }

  return { districtIds: entries.map(([districtId]) => districtId).sort(), count: entries.length };
}

export function entitledDistrictIds(users, now = new Date()) {
  const active = new Set();
  for (const user of users || []) {
    const metadata = user?.app_metadata || {};
    const districtId = String(metadata.district_id || "");
    if (!districtId || /(?:^|-)(?:test|demo)(?:-|$)/i.test(districtId) || metadata.role === "admin") continue;

    const paidThrough = parseTime(metadata.paid_through);
    const trialEnd = parseTime(metadata.trial_ends_at || metadata.trial_end);
    const paid = metadata.payment_status === "paid" && (!paidThrough || paidThrough > now);
    const complimentary = metadata.payment_status === "complimentary" && paidThrough !== null && paidThrough > now;
    const trial = new Set(["active", "trialing"]).has(metadata.trial_status) && (!trialEnd || trialEnd > now);
    const access = !new Set(["disabled", "expired", "revoked"]).has(metadata.access_status);
    if (access && (paid || complimentary || trial)) active.add(districtId);
  }
  return [...active].sort();
}

export function assertExactRosterScope(manifest, liveDistrictIds) {
  const { districtIds } = validateRosterManifest(manifest);
  const live = [...new Set(liveDistrictIds || [])].sort();
  if (JSON.stringify(districtIds) !== JSON.stringify(live)) {
    throw new Error(`Canary roster mismatch. Approved=${JSON.stringify(districtIds)} Live=${JSON.stringify(live)}`);
  }
  return districtIds;
}

export function assertAllowedDistrict(manifest, districtId) {
  validateRosterManifest(manifest);
  if (!manifest.districts?.[districtId]) {
    throw new Error(`District is outside the approved Canary roster: ${districtId}`);
  }
  return manifest.districts[districtId];
}

export function assertDistrictRows(manifest, rows) {
  const expected = new Map(Object.entries(manifest.districts).map(([id, config]) => [id, config.name]));
  const actual = new Map((rows || []).map((row) => [row.id, row.name]));
  for (const [districtId, expectedName] of expected) {
    if (actual.get(districtId) !== expectedName) {
      throw new Error(`Canary district record mismatch for ${districtId}`);
    }
  }
  if (actual.size !== expected.size) throw new Error("Unexpected district rows returned during roster validation");
  return true;
}
