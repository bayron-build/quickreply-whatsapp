import { describe, it, expect, beforeEach } from "vitest";
import type { LicenseState } from "../src/lib/types";
import { DAY_MS } from "../src/lib/types";

const backing = new Map<string, unknown>();

(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: backing.get(key) };
      },
      async set(items: Record<string, unknown>) {
        for (const [k, v] of Object.entries(items)) backing.set(k, v);
      },
    },
  },
};

import { proView, isPro, applyValidation, getLicense, saveLicense } from "../src/lib/license";

const NOW = 1_800_000_000_000;

function active(lastValidatedAt: number): LicenseState {
  return { key: "K", instanceId: "I", plan: "Pro", status: "active", lastValidatedAt };
}

describe("proView / isPro", () => {
  it("no license → free", () => {
    expect(proView(null, NOW)).toBe("free");
    expect(isPro(null, NOW)).toBe(false);
  });

  it("recently validated → active", () => {
    expect(proView(active(NOW - DAY_MS), NOW)).toBe("active");
    expect(isPro(active(NOW - DAY_MS), NOW)).toBe(true);
  });

  it("past the weekly cadence but within 14-day grace → offline, still Pro", () => {
    expect(proView(active(NOW - 10 * DAY_MS), NOW)).toBe("offline");
    expect(isPro(active(NOW - 10 * DAY_MS), NOW)).toBe(true);
  });

  it("grace exhausted (>14 days unvalidated) → invalid view, not Pro", () => {
    expect(proView(active(NOW - 15 * DAY_MS), NOW)).toBe("invalid");
    expect(isPro(active(NOW - 15 * DAY_MS), NOW)).toBe(false);
  });

  it("confirmed-invalid license → invalid regardless of recency", () => {
    const st = { ...active(NOW), status: "invalid" as const };
    expect(proView(st, NOW)).toBe("invalid");
    expect(isPro(st, NOW)).toBe(false);
  });
});

describe("applyValidation", () => {
  const st = active(NOW - 8 * DAY_MS);

  it("valid → active with refreshed lastValidatedAt", () => {
    expect(applyValidation(st, "valid", NOW)).toEqual({ ...st, status: "active", lastValidatedAt: NOW });
  });

  it("invalid → status invalid, data untouched otherwise", () => {
    expect(applyValidation(st, "invalid", NOW)).toEqual({ ...st, status: "invalid" });
  });

  it("unreachable → state unchanged (grace keeps running)", () => {
    expect(applyValidation(st, "unreachable", NOW)).toEqual(st);
  });

  it("a later valid validation recovers an invalid state", () => {
    const invalid = { ...st, status: "invalid" as const };
    expect(applyValidation(invalid, "valid", NOW).status).toBe("active");
  });
});

describe("license storage", () => {
  beforeEach(() => backing.clear());

  it("null on fresh install; round-trips; null clears", async () => {
    expect(await getLicense()).toBeNull();
    await saveLicense(active(NOW));
    expect(await getLicense()).toEqual(active(NOW));
    await saveLicense(null);
    expect(await getLicense()).toBeNull();
  });
});
