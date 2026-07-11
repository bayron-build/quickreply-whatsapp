/**
 * The single gate every Pro check goes through. Until the license module
 * ships (wired in a later task), everyone is on the free tier.
 */
export async function isProActive(): Promise<boolean> {
  return false;
}
