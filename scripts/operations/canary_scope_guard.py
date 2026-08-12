import json
import hashlib
import pathlib
import re

ROSTER_PATH = pathlib.Path(__file__).resolve().parents[2] / "config" / "canary-social-client-roster.json"
APPROVED_DISTRICT_IDS = frozenset({
    "alabaster-city-schools",
    "alief-independent-school-district",
    "auburn-city-schools",
    "fort-wayne-community-schools",
    "garfield-school-district-re-2",
    "hoover-city-schools",
    "shelby-county-school-district",
    "spartanburg-district-five-schools",
    "stafford-county-public-schools",
    "tuscaloosa-city-schools",
})
APPROVED_ROSTER_SHA256 = "530a6d4c601a2b258a3455fe09a163339381939c337f7992a55a306d783ae0b7"
FORBIDDEN_ORGANIZATION = re.compile(r"(?:\beic\b|good[ -]?game|infinite[ -]?heart)", re.I)


def load_canary_roster():
    payload = ROSTER_PATH.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != APPROVED_ROSTER_SHA256:
        raise RuntimeError(
            f"Approved Canary roster content changed. Expected SHA256={APPROVED_ROSTER_SHA256} Actual={digest}"
        )
    manifest = json.loads(payload)
    rules = manifest.get("rules") or {}
    if manifest.get("organization_boundary") != "canary_only":
        raise RuntimeError("Roster must declare organization_boundary=canary_only")
    if manifest.get("scope") != "active_paid_and_trial_school_districts":
        raise RuntimeError("Roster scope is not approved")
    if not all(
        rules.get(key) is True
        for key in (
            "allowlist_only",
            "exclude_test_demo_and_admin",
            "reject_unknown_organizations",
            "eic_and_eic_clients_are_out_of_scope",
        )
    ):
        raise RuntimeError("Roster isolation rules are incomplete")

    districts = manifest.get("districts") or {}
    if set(districts) != APPROVED_DISTRICT_IDS:
        raise RuntimeError(
            f"Approved Canary district allowlist changed. "
            f"Expected={sorted(APPROVED_DISTRICT_IDS)} Actual={sorted(districts)}"
        )
    for district_id, config in districts.items():
        name = str(config.get("name") or "")
        if re.search(r"(?:^|-)(?:test|demo)(?:-|$)", district_id, re.I):
            raise RuntimeError(f"Test/demo district is forbidden: {district_id}")
        if not re.search(r"(?:school|district)", name, re.I):
            raise RuntimeError(f"Non-school organization is forbidden: {district_id}")
        if FORBIDDEN_ORGANIZATION.search(f"{district_id} {name}"):
            raise RuntimeError(f"EIC or EIC-client organization is forbidden: {district_id}")
        if config.get("type") not in {"paid", "trial"}:
            raise RuntimeError(f"Invalid Canary entitlement type: {district_id}")
    return manifest


def require_approved_district(district_id, districts=None):
    roster = districts or load_canary_roster()["districts"]
    if district_id not in APPROVED_DISTRICT_IDS or district_id not in roster:
        raise RuntimeError(f"District is outside the approved Canary roster: {district_id}")
    return roster[district_id]
