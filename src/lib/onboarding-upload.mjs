export const MAX_STRATEGIC_PLAN_FILE_BYTES = 4 * 1024 * 1024;

export function assertStrategicPlanFileSize(file) {
  if (file && typeof file.size === 'number' && file.size > MAX_STRATEGIC_PLAN_FILE_BYTES) {
    throw new Error('Document is too large (4 MB maximum).');
  }
}