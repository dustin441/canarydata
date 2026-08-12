#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assertAllowedDistrict,
  assertDistrictRows,
  assertExactRosterScope,
  entitledDistrictIds,
  validateRosterManifest,
} from "./lib/canary-client-roster.mjs";

const rosterPath = path.resolve(
  process.env.CANARY_SOCIAL_ROSTER_PATH || "config/canary-social-client-roster.json",
);
const manifest = JSON.parse(await fs.readFile(rosterPath, "utf8"));
const staticResult = validateRosterManifest(manifest);
const districtArgIndex = process.argv.indexOf("--district");
const selectedDistrict = districtArgIndex >= 0 ? process.argv[districtArgIndex + 1] : null;
if (districtArgIndex >= 0 && !selectedDistrict) throw new Error("--district requires a value");
if (selectedDistrict) assertAllowedDistrict(manifest, selectedDistrict);

if (process.argv.includes("--offline")) {
  console.log(JSON.stringify({ status: "passed", mode: "offline", rosterPath, ...staticResult, selectedDistrict }, null, 2));
  process.exit(0);
}

const supabaseUrl = String(process.env.CANARY_PROD_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Live validation requires CANARY_PROD_SUPABASE_URL and CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY");
}
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Canary read failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const users = [];
for (let page = 1; page <= 100; page += 1) {
  const payload = await getJson(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`);
  const batch = payload.users || [];
  users.push(...batch);
  if (batch.length < 100) break;
  if (page === 100) throw new Error("Auth pagination exceeded safety limit");
}
const liveDistrictIds = entitledDistrictIds(users);
const approvedDistrictIds = assertExactRosterScope(manifest, liveDistrictIds);
const inFilter = encodeURIComponent(`in.(${approvedDistrictIds.join(",")})`);
const districtRows = await getJson(`${supabaseUrl}/rest/v1/districts?id=${inFilter}&select=id,name&order=id.asc`);
assertDistrictRows(manifest, districtRows);

console.log(JSON.stringify({
  status: "passed",
  mode: "live",
  organizationBoundary: manifest.organization_boundary,
  rosterPath,
  approvedDistrictIds,
  selectedDistrict,
  eicOrganizationsIncluded: 0,
  mutationsPerformed: 0,
}, null, 2));
