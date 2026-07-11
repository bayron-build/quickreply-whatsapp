import { describe, it, expect } from "vitest";
import type { Template } from "../src/lib/types";
import { exportToJson, parseImport, capImport } from "../src/lib/importExport";

const tpl: Template = {
  id: "old-id",
  title: "Greeting",
  shortcut: "hi",
  body: "Hi {name}!",
  createdAt: 123,
  usageCount: 7,
};

describe("exportToJson / parseImport round-trip", () => {
  it("round-trips template content with fresh ids", () => {
    const result = parseImport(exportToJson([tpl]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.templates).toHaveLength(1);
    const t = result.templates[0];
    expect(t.title).toBe("Greeting");
    expect(t.shortcut).toBe("hi");
    expect(t.body).toBe("Hi {name}!");
    expect(t.usageCount).toBe(7);
    expect(t.id).not.toBe("old-id");
  });
});

describe("parseImport validation", () => {
  it("rejects non-JSON", () => {
    expect(parseImport("not json {")).toEqual({ ok: false, error: "invalid-json" });
  });

  it("rejects JSON without a templates array", () => {
    expect(parseImport(JSON.stringify({ hello: 1 }))).toEqual({
      ok: false,
      error: "invalid-format",
    });
  });

  it("rejects a template missing required string fields", () => {
    const bad = JSON.stringify({ templates: [{ title: "x", body: 42 }] });
    expect(parseImport(bad)).toEqual({ ok: false, error: "invalid-template" });
  });

  it("defaults usageCount to 0 when missing", () => {
    const json = JSON.stringify({ templates: [{ title: "a", shortcut: "", body: "b" }] });
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.templates[0].usageCount).toBe(0);
  });
});

function mkTpl(id: string): Template {
  return { id, title: id, shortcut: "", body: "x", createdAt: 1, usageCount: 0 };
}

describe("capImport", () => {
  const incoming = [mkTpl("a"), mkTpl("b"), mkTpl("c")];

  it("accepts everything under the cap", () => {
    expect(capImport(0, incoming, false)).toEqual({ accepted: incoming, skipped: 0 });
  });

  it("partially applies up to the cap and reports the remainder", () => {
    const r = capImport(13, incoming, false);
    expect(r.accepted.map((t) => t.id)).toEqual(["a", "b"]);
    expect(r.skipped).toBe(1);
  });

  it("accepts nothing at or beyond the cap — existing templates untouched conceptually", () => {
    expect(capImport(15, incoming, false)).toEqual({ accepted: [], skipped: 3 });
    expect(capImport(20, incoming, false)).toEqual({ accepted: [], skipped: 3 });
  });

  it("pro is unlimited", () => {
    expect(capImport(999, incoming, true)).toEqual({ accepted: incoming, skipped: 0 });
  });
});
