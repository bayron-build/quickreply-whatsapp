import { describe, it, expect } from "vitest";
import { buildFillFields, needsFillForm } from "../src/lib/fillForm";

const autoVars = { name: "Budi", today: "11 July 2026" };

describe("buildFillFields", () => {
  it("marks auto-fillable placeholders with their values, unknowns empty", () => {
    expect(buildFillFields("Hi {name}, order {tracking} total {total}", autoVars)).toEqual([
      { key: "name", value: "Budi", auto: true },
      { key: "tracking", value: "", auto: false },
      { key: "total", value: "", auto: false },
    ]);
  });

  it("deduplicates repeated placeholders, preserving first-appearance order", () => {
    expect(buildFillFields("{total} then {name} then {total}", autoVars).map((f) => f.key)).toEqual([
      "total",
      "name",
    ]);
  });

  it("returns [] for a body without placeholders", () => {
    expect(buildFillFields("plain text", autoVars)).toEqual([]);
  });

  it("treats an auto var with empty value (no open chat → name '') as auto", () => {
    expect(buildFillFields("{name}", { name: "" })).toEqual([{ key: "name", value: "", auto: true }]);
  });
});

describe("needsFillForm", () => {
  it("true only when at least one field is not auto-fillable", () => {
    expect(needsFillForm(buildFillFields("Hi {name} {total}", autoVars))).toBe(true);
    expect(needsFillForm(buildFillFields("Hi {name}, see you {today}", autoVars))).toBe(false);
    expect(needsFillForm([])).toBe(false);
  });
});
