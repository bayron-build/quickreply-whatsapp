/**
 * The single gate every Pro check goes through: reminder cap, fill-in
 * form, template cap. Reads the stored license through the pure state
 * machine (14-day offline grace included).
 */
import { getLicense, isPro } from "./license";

export async function isProActive(now = Date.now()): Promise<boolean> {
  return isPro(await getLicense(), now);
}
