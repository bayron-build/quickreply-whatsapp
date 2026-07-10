import { describe, it, expect } from "vitest";
import { systemPlaceholders } from "../src/lib/systemVars";

// Fixed moment: Friday 2026-07-10, 14:05 local time.
const now = new Date(2026, 6, 10, 14, 5);

describe("systemPlaceholders", () => {
  it("fills today/time/tomorrow in English", () => {
    const vars = systemPlaceholders(now, "en-US");
    expect(vars.today).toBe("July 10, 2026");
    expect(vars.tomorrow).toBe("July 11, 2026");
    expect(vars.time).toMatch(/^0?2:05\sPM$/i);
  });

  it("fills Indonesian aliases with the same values", () => {
    const vars = systemPlaceholders(now, "id-ID");
    expect(vars.hari_ini).toBe("10 Juli 2026");
    expect(vars.besok).toBe("11 Juli 2026");
    expect(vars.jam).toBe(vars.time);
    expect(vars.today).toBe(vars.hari_ini);
  });

  it("rolls tomorrow across month ends", () => {
    const endOfMonth = new Date(2026, 6, 31, 9, 0);
    const vars = systemPlaceholders(endOfMonth, "en-US");
    expect(vars.tomorrow).toBe("August 1, 2026");
  });
});
