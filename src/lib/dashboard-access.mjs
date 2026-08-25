export const DEMO_REVIEWER_ROLE = 'demo_reviewer';

export function normalizeDashboardDistrictIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function resolveDemoReviewerAccess({ metadata = {}, districts = [], requestedDistrictId = '' } = {}) {
  const isDemoReviewer = metadata?.role === DEMO_REVIEWER_ROLE;
  if (!isDemoReviewer) {
    return {
      isDemoReviewer: false,
      districtIds: [],
      districts,
      selectedDistrictId: null,
      hasAccess: true,
    };
  }

  const configuredDistrictIds = normalizeDashboardDistrictIds(metadata?.district_ids);
  const existingDistrictIds = new Set(districts.map((district) => String(district?.id || '')));
  const districtIds = configuredDistrictIds.filter((districtId) => existingDistrictIds.has(districtId));
  const visibleDistricts = districts.filter((district) => districtIds.includes(String(district?.id || '')));
  const preferredDistrictId = String(metadata?.district_id || '');
  const requested = String(requestedDistrictId || '');
  const selectedDistrictId = districtIds.includes(requested)
    ? requested
    : districtIds.includes(preferredDistrictId)
      ? preferredDistrictId
      : districtIds[0] || null;

  return {
    isDemoReviewer: true,
    districtIds,
    districts: visibleDistricts,
    selectedDistrictId,
    hasAccess: Boolean(selectedDistrictId),
  };
}
