/** Application-audience restrictions apply even to an adult's request.
 * Kept dependency-free for Edge/client evaluation imports. No env bypass. */
export function providerAllowedForGlobalAudience(provider: string): boolean {
  return provider !== 'gemini' && provider !== 'vertex_gemini' && provider !== 'soscripted';
}
/** Optional behavioral analytics is off until a separately reviewed consent
 * and age-aware collection policy ships. No anonymous identifier is created. */
export function optionalAnalyticsEnabled(): boolean { return false; }
