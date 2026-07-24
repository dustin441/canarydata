export function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

export function resolveSocialReportWindow(period, asOf, customStart = '', customEnd = '') {
  const end = new Date(asOf);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  let start;
  let rangeEnd = end;
  let label = 'Last 30 days';

  if (period === 'this-month') {
    start = new Date(Date.UTC(year, month, 1));
    label = 'This month';
  } else if (period === 'previous-month') {
    start = new Date(Date.UTC(year, month - 1, 1));
    rangeEnd = new Date(Date.UTC(year, month, 1) - 1);
    label = 'Previous month';
  } else if (period === 'school-year') {
    const isOnOrAfterSchoolYearStart = month > 6 || (month === 6 && end.getUTCDate() >= 15);
    const startYear = isOnOrAfterSchoolYearStart ? year : year - 1;
    start = new Date(Date.UTC(startYear, 6, 15));
    label = `School year ${startYear}–${String(startYear + 1).slice(-2)}`;
  } else if (period === 'calendar-year') {
    start = new Date(Date.UTC(year, 0, 1));
    label = `Calendar year ${year}`;
  } else if (period === 'custom') {
    start = customStart ? new Date(`${customStart}T00:00:00.000Z`) : new Date(0);
    rangeEnd = customEnd ? new Date(`${customEnd}T23:59:59.999Z`) : end;
    label = customStart || customEnd ? `Custom ${customStart || 'beginning'} to ${customEnd || 'today'}` : 'Custom range';
  } else {
    start = new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000));
  }

  return { start, end: rangeEnd, label, startInput: dateInputValue(start), endInput: dateInputValue(rangeEnd) };
}

export function groupTopReportPostsByPlatform(results, limitPerPlatform = 3) {
  const preferredOrder = ['facebook', 'instagram'];
  const eligible = results.filter((result) => result.visibilityStatus === 'active' && result.relationshipType === 'owned');
  const platforms = [...new Set(eligible.map((result) => result.platform).filter(Boolean))].sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? preferredOrder.length : aIndex) - (bIndex < 0 ? preferredOrder.length : bIndex);
    return a.localeCompare(b);
  });

  return platforms.map((platform) => ({
    platform,
    posts: eligible
      .filter((result) => result.platform === platform)
      .sort((a, b) => (Number(b.engagementTotal) - Number(a.engagementTotal))
        || String(b.date || '').localeCompare(String(a.date || ''))
        || String(a.id || '').localeCompare(String(b.id || '')))
      .slice(0, limitPerPlatform),
  }));
}
