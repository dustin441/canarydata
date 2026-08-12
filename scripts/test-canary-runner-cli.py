#!/usr/bin/env python3
import ast
import datetime
import pathlib
import shutil
import subprocess

OWNED = "/opt/data/tmp/canary_all_active_owned_backfill.py"
PUBLIC = "/opt/data/tmp/canary_all_active_public_backfill.py"
ROOT = pathlib.Path("/tmp/canary-runner-cli-safety")
shutil.rmtree(ROOT, ignore_errors=True)

cases = [
    (
        "owned execute without district",
        ["python3", OWNED, "--execute", "--output-dir", str(ROOT / "owned-no-district")],
        "--execute requires an explicit --district",
        ROOT / "owned-no-district",
    ),
    (
        "public execute without district",
        ["python3", PUBLIC, "--execute", "--platform", "instagram", "--output-dir", str(ROOT / "public-no-district")],
        "--execute requires an explicit --district",
        ROOT / "public-no-district",
    ),
    (
        "public execute without platform",
        ["python3", PUBLIC, "--execute", "--district", "shelby-county-school-district", "--output-dir", str(ROOT / "public-no-platform")],
        "--execute requires at least one explicit --platform",
        ROOT / "public-no-platform",
    ),
]
for label, command, expected, output_dir in cases:
    result = subprocess.run(command, text=True, capture_output=True, timeout=30)
    assert result.returncode == 2, (label, result.returncode, result.stdout, result.stderr)
    assert expected in result.stderr, (label, result.stderr)
    assert not output_dir.exists(), (label, "runner initialized before parser safety gate")

source = pathlib.Path(PUBLIC).read_text()
assert "remaining-max_charge<10" in source, "runner does not reserve the maximum provider charge above the $10 safety floor"
assert "cannot reserve" in source, "runner budget rejection is not explicit"
tree = ast.parse(source)
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"parse_time", "same_protected_value"}]
namespace = {"datetime": datetime}
exec(compile(ast.Module(body=helpers, type_ignores=[]), PUBLIC, "exec"), namespace)
same = namespace["same_protected_value"]
assert same("first_seen_at", "2026-08-08T03:07:11.61807+00:00", "2026-08-08T03:07:11.618070+00:00")
assert same("reviewed_at", "2026-08-08T03:07:11Z", "2026-08-08T03:07:11+00:00")
assert not same("first_seen_at", "2026-08-08T03:07:12+00:00", "2026-08-08T03:07:11+00:00")
assert not same("first_seen_at", "not-a-time", "also-not-a-time")
assert not same("visibility_status", "excluded", "active")

print("Canary runner CLI safety tests passed")
