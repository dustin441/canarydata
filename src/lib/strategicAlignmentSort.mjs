const ORDINAL_LABEL_PATTERN = /\b(?:strategic\s+)?(pillar|goal|priority|objective|focus\s+area)\s*(?:#|no\.?|number)?\s*([0-9]+|[ivxlcdm]+)\b/i;
const VALID_ROMAN_PATTERN = /^(?=[MDCLXVI]+$)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

function romanToNumber(value) {
  const roman = String(value ?? '').toUpperCase();
  if (!VALID_ROMAN_PATTERN.test(roman)) return null;

  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman[index]];
    const next = values[roman[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

export function parseStrategicAlignmentOrdinal(label) {
  const match = String(label ?? '').match(ORDINAL_LABEL_PATTERN);
  if (!match) return null;

  const ordinal = /^\d+$/.test(match[2]) ? Number(match[2]) : romanToNumber(match[2]);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) return null;

  return {
    family: match[1].toLowerCase().replace(/\s+/g, ' '),
    ordinal,
  };
}

export function compareStrategicAlignmentRows(a, b) {
  const aOrdinal = parseStrategicAlignmentOrdinal(a.label);
  const bOrdinal = parseStrategicAlignmentOrdinal(b.label);

  if (
    aOrdinal
    && bOrdinal
    && aOrdinal.family === bOrdinal.family
    && aOrdinal.ordinal !== bOrdinal.ordinal
  ) {
    return aOrdinal.ordinal - bOrdinal.ordinal;
  }

  return b.count - a.count || a.label.localeCompare(b.label);
}
