#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  assertAllowedDistrict,
  assertDistrictRows,
  assertExactRosterScope,
  entitledDistrictIds,
  validateRosterManifest,
} from "./lib/canary-client-roster.mjs";

const manifest = JSON.parse(await fs.readFile(new URL("../config/canary-social-client-roster.json", import.meta.url), "utf8"));
const { districtIds, count } = validateRosterManifest(manifest);
assert.equal(count, 10);
assert.equal(districtIds.includes("good-game"), false);
assert.equal(districtIds.includes("infinite-heart-health"), false);
assert.throws(() => assertAllowedDistrict(manifest, "good-game"), /outside the approved Canary roster/);
assert.throws(() => assertAllowedDistrict(manifest, "infinite-heart-health"), /outside the approved Canary roster/);

const now = new Date("2026-08-07T23:00:00Z");
const users = districtIds.map((districtId, index) => ({
  app_metadata: index < 4
    ? { district_id: districtId, payment_status: "paid", paid_through: "2027-01-01T00:00:00Z", access_status: "active" }
    : { district_id: districtId, trial_status: "active", trial_ends_at: "2026-09-01T00:00:00Z", access_status: "active" },
}));
assert.deepEqual(entitledDistrictIds(users, now), districtIds);
assert.deepEqual(assertExactRosterScope(manifest, entitledDistrictIds(users, now)), districtIds);
assert.throws(
  () => assertExactRosterScope(manifest, [...districtIds, "good-game"]),
  /Canary roster mismatch/,
);
assert.throws(
  () => assertExactRosterScope(manifest, districtIds.filter((districtId) => districtId !== districtIds[0])),
  /Canary roster mismatch/,
);

const expiredTrial = [{
  app_metadata: {
    district_id: "expired-school-district",
    trial_status: "active",
    trial_ends_at: "2026-08-01T00:00:00Z",
    access_status: "active",
  },
}];
assert.deepEqual(entitledDistrictIds(expiredTrial, now), []);

const rows = districtIds.map((id) => ({ id, name: manifest.districts[id].name }));
assert.equal(assertDistrictRows(manifest, rows), true);
assert.throws(() => assertDistrictRows(manifest, rows.slice(1)), /district record mismatch|Unexpected district rows/);

const contaminated = structuredClone(manifest);
contaminated.districts["good-game"] = { name: "Good Game", type: "paid" };
assert.throws(() => validateRosterManifest(contaminated), /not a school district|EIC or EIC-client/);

console.log("Canary client roster isolation tests passed");
