#!/usr/bin/env python3
import copy
import importlib.util
import json
import pathlib

MODULE_PATH = pathlib.Path(__file__).parent / "operations" / "canary_scope_guard.py"
spec = importlib.util.spec_from_file_location("canary_scope_guard", MODULE_PATH)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

manifest = guard.load_canary_roster()
assert manifest["organization_boundary"] == "canary_only"
assert set(manifest["districts"]) == guard.APPROVED_DISTRICT_IDS
assert "good-game" not in manifest["districts"]
assert "infinite-heart-health" not in manifest["districts"]

for district_id in guard.APPROVED_DISTRICT_IDS:
    assert guard.require_approved_district(district_id, manifest["districts"])["type"] in {"paid", "trial"}

for forbidden in ("good-game", "infinite-heart-health", "eic-client"):
    try:
        guard.require_approved_district(forbidden, manifest["districts"])
    except RuntimeError as error:
        assert "outside the approved Canary roster" in str(error)
    else:
        raise AssertionError(f"Forbidden organization was accepted: {forbidden}")

mutations = []
extra_org = copy.deepcopy(manifest)
extra_org["districts"]["good-game"] = {"name": "Good Game", "type": "paid"}
mutations.append(("extra organization", extra_org))
for label, field, value in (
    ("official handle", ("facebook", "handle"), "unapproved-handle"),
    ("official URL", ("facebook", "url"), "https://example.com/unapproved"),
    ("public query", ("public_query",), "unapproved query"),
    ("affiliate registry", ("affiliate_terms",), ["unapproved affiliate"]),
):
    changed = copy.deepcopy(manifest)
    target = changed["districts"]["shelby-county-school-district"]
    if len(field) == 2:
        target[field[0]][field[1]] = value
    else:
        target[field[0]] = value
    mutations.append((label, changed))

original_path = guard.ROSTER_PATH
temporary = pathlib.Path("/tmp/canary-contaminated-roster-test.json")
try:
    guard.ROSTER_PATH = temporary
    for label, changed in mutations:
        temporary.write_text(json.dumps(changed, indent=2) + "\n")
        try:
            guard.load_canary_roster()
        except RuntimeError as error:
            assert "roster content changed" in str(error), (label, str(error))
        else:
            raise AssertionError(f"Contaminated manifest was accepted: {label}")
finally:
    guard.ROSTER_PATH = original_path
    temporary.unlink(missing_ok=True)

print("Canary Python scope guard tests passed")
