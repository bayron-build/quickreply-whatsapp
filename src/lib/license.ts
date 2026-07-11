/**
 * License state machine (pure, tested) + the ONLY code that talks to the
 * payment provider. Provider = Lemon Squeezy; a swap to Paddle touches
 * this file alone. Network policy: these three endpoints are the only
 * network calls in the entire extension, and only run when the user has
 * entered a license key.
 */
import type { LicenseState } from "./types";
import { DAY_MS, LICENSE_GRACE_MS } from "./types";
import { read, write } from "./storage";

export type ValidationOutcome = "valid" | "invalid" | "unreachable";
export type ActivateResult =
  | { ok: true; state: LicenseState }
  | { ok: false; error: "invalid-key" | "network" };

/** Past this long without successful validation, "active" shows as offline. */
const OFFLINE_AFTER_MS = 8 * DAY_MS; // one weekly cycle + a day of slack

// ---------- pure machine ----------

export function proView(
  state: LicenseState | null,
  now: number
): "free" | "active" | "offline" | "invalid" {
  if (!state) return "free";
  if (state.status === "invalid") return "invalid";
  const sinceValidated = now - state.lastValidatedAt;
  if (sinceValidated > LICENSE_GRACE_MS) return "invalid";
  if (sinceValidated > OFFLINE_AFTER_MS) return "offline";
  return "active";
}

export function isPro(state: LicenseState | null, now: number): boolean {
  const view = proView(state, now);
  return view === "active" || view === "offline";
}

export function applyValidation(
  state: LicenseState,
  outcome: ValidationOutcome,
  now: number
): LicenseState {
  if (outcome === "valid") return { ...state, status: "active", lastValidatedAt: now };
  if (outcome === "invalid") return { ...state, status: "invalid" };
  return state; // unreachable: grace period keeps running
}

// ---------- storage ----------

export async function getLicense(): Promise<LicenseState | null> {
  return read<LicenseState | null>("license", null);
}

export async function saveLicense(state: LicenseState | null): Promise<void> {
  await write("license", state);
}

// ---------- provider client (thin, reviewed by hand) ----------

const API = "https://api.lemonsqueezy.com/v1/licenses";

// Lemon Squeezy's License API expects form-encoded POST bodies
// (Content-Type: application/x-www-form-urlencoded) with an
// Accept: application/json header — per the current License API docs.
async function post(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
}

// Verdict rule for both calls below: only an explicit provider verdict
// downgrades a license; ambiguity favors the user (grace). A transient
// 429/WAF/proxy JSON body without the verdict field must never read as a
// rejection — revalidateIfDue skips invalid states, so a wrong "invalid"
// would soft-lock a paying user until manual re-activation.
export async function activateLicense(key: string, now = Date.now()): Promise<ActivateResult> {
  let data: {
    activated?: boolean;
    instance?: { id?: string };
    meta?: { variant_name?: string };
  };
  try {
    const res = await post("activate", { license_key: key, instance_name: "quickreply-extension" });
    if (res.status >= 500) return { ok: false, error: "network" };
    data = await res.json();
  } catch {
    return { ok: false, error: "network" };
  }
  // Only `activated === false` is the provider rejecting the key. Any other
  // non-conforming body (activated missing/not boolean, or activated true
  // without an instance id) is ambiguous → network error, so the user retries.
  if (data.activated === false) {
    return { ok: false, error: "invalid-key" };
  }
  if (data.activated !== true || typeof data.instance?.id !== "string") {
    return { ok: false, error: "network" };
  }
  return {
    ok: true,
    state: {
      key,
      instanceId: data.instance.id,
      plan: data.meta?.variant_name ?? "Pro",
      status: "active",
      lastValidatedAt: now,
    },
  };
}

export async function revalidateLicense(state: LicenseState): Promise<ValidationOutcome> {
  try {
    const res = await post("validate", { license_key: state.key, instance_id: state.instanceId });
    if (res.status >= 500) return "unreachable";
    const data: { valid?: boolean } = await res.json();
    if (data.valid === true) return "valid";
    // Explicit provider verdict only: `valid === false` means key/instance
    // rejected. A body without the field (429/WAF page parsed as JSON, API
    // shape drift) is ambiguous → unreachable, and the 14-day grace runs.
    if (data.valid === false) return "invalid";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

/** Best-effort courtesy call so the seat frees up server-side. */
export async function deactivateLicense(state: LicenseState): Promise<void> {
  try {
    await post("deactivate", { license_key: state.key, instance_id: state.instanceId });
  } catch {
    // Local removal is what matters; the server seat expires on its own.
  }
}
