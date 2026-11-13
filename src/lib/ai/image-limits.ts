export const STANDARD_HOURLY_IMAGE_LIMIT = 5;
export const PRIVATE_BETA_HOURLY_IMAGE_LIMIT = 100;

export function getHourlyImageLimit(entitlementType: string): number {
  return entitlementType === "internal_beta"
    ? PRIVATE_BETA_HOURLY_IMAGE_LIMIT
    : STANDARD_HOURLY_IMAGE_LIMIT;
}

export function hasReachedHourlyImageLimit(usageCount: number, limit: number): boolean {
  return !Number.isFinite(usageCount) || usageCount < 0 || usageCount > limit;
}
