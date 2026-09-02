export const PURCHASE_ORDER_MAX_LENGTH = 80;

const PLACEHOLDERS = new Set([
  'na',
  'none',
  'null',
  'pending',
  'tbd',
  'tobedetermined',
  'notapplicable',
  'notavailable',
  'unknown',
  'test',
  'testing',
  'sample',
  'demo',
  'placeholder',
]);

export function normalizePurchaseOrder(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function validatePurchaseOrder(value) {
  const normalized = normalizePurchaseOrder(value);
  if (!normalized) return { present: false, valid: false, normalized: '', reason: 'required' };
  if (normalized.length > PURCHASE_ORDER_MAX_LENGTH) {
    return { present: true, valid: false, normalized, reason: 'too_long' };
  }
  if (!/[A-Za-z0-9]/.test(normalized)) {
    return { present: true, valid: false, normalized, reason: 'missing_identifier' };
  }
  if (!/^[A-Za-z0-9 ._#/-]+$/.test(normalized)) {
    return { present: true, valid: false, normalized, reason: 'unsupported_characters' };
  }
  const identifier = normalized.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (identifier.length < 3) {
    return { present: true, valid: false, normalized, reason: 'too_short' };
  }
  if (PLACEHOLDERS.has(identifier)) {
    return { present: true, valid: false, normalized, reason: 'placeholder' };
  }
  if (/^0+$/.test(identifier)) {
    return { present: true, valid: false, normalized, reason: 'all_zeros' };
  }
  return { present: true, valid: true, normalized, reason: null };
}

export function requireValidPurchaseOrder(value) {
  const result = validatePurchaseOrder(value);
  if (!result.valid) {
    const error = new Error(result.reason === 'required'
      ? 'Enter a purchase order number before saving.'
      : result.reason === 'too_long'
        ? `Purchase order numbers must be ${PURCHASE_ORDER_MAX_LENGTH} characters or fewer.`
        : result.reason === 'too_short'
          ? 'Enter a purchase order number with at least three letters or numbers.'
        : result.reason === 'unsupported_characters'
          ? 'Use only letters, numbers, spaces, periods, slashes, hyphens, underscores, or # in the purchase order number.'
          : 'Enter the district-issued purchase order number, not a placeholder.');
    error.code = 'INVALID_PURCHASE_ORDER';
    throw error;
  }
  return result.normalized;
}
