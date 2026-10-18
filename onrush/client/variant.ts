// Build-only adapter: product branding is separate from upstream RPC variants.
export const SITE_VARIANT: string = 'full';
export const SITE_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'energy'] as const;
export type SiteVariant = (typeof SITE_VARIANTS)[number];
export function isSiteVariant(value: string | null | undefined): value is SiteVariant { return value === 'full'; }
