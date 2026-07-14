const NUMBERED_PILLAR_PATTERN = /\bpillar\s+(\d+)\b/i;

function numberedPillar(label) {
  const match = String(label ?? '').match(NUMBERED_PILLAR_PATTERN);
  return match ? Number(match[1]) : null;
}

export function compareStrategicAlignmentRows(a, b) {
  const aPillar = numberedPillar(a.label);
  const bPillar = numberedPillar(b.label);

  if (aPillar !== null && bPillar !== null && aPillar !== bPillar) {
    return aPillar - bPillar;
  }

  return b.count - a.count || a.label.localeCompare(b.label);
}
