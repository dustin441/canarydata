import assert from 'node:assert/strict';

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      assert.equal(cell, '', 'Malformed CSV quote');
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  assert.equal(quoted, false, 'Unterminated quoted CSV cell');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

export function parseSqlEditorExport(text, expectedColumn) {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  assert.ok(trimmed, 'SQL Editor export is empty');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Normal SQL Editor CSV escapes the JSON cell; parse it as RFC 4180 below.
      }
    }
    const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
    assert.equal(rows.length, 2, 'SQL Editor CSV must contain one header row and one result row');
    assert.equal(rows[0].length, 1, 'SQL Editor CSV must contain exactly one column');
    assert.equal(rows[1].length, 1, 'SQL Editor CSV result must contain exactly one cell');
    assert.equal(rows[0][0].trim(), expectedColumn, `SQL Editor CSV column must be ${expectedColumn}`);
    return JSON.parse(rows[1][0]);
  }
}

export function unwrapSingleSqlEditorValue(value, property) {
  let normalized = value;
  if (Array.isArray(normalized) && normalized.length === 1) normalized = normalized[0];
  if (normalized && typeof normalized === 'object' && Object.hasOwn(normalized, property)) normalized = normalized[property];
  if (typeof normalized === 'string') normalized = JSON.parse(normalized);
  return normalized;
}
