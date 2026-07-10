import { describe, it, expect } from "vitest";
import type { Template } from "../src/lib/types";
import { rankTemplates } from "../src/lib/search";

function mk(partial: Partial<Template> & { title: string }): Template {
  return {
    id: partial.title,
    shortcut: "",
    body: "",
    createdAt: 0,
    usageCount: 0,
    ...partial,
  };
}

describe("rankTemplates", () => {
  const ship = mk({ title: "Shipping info", shortcut: "ship", usageCount: 5 });
  const shipped = mk({ title: "Order shipped", shortcut: "shipped", usageCount: 50 });
  const thanks = mk({ title: "Thank you", shortcut: "ty", usageCount: 99 });
  const all = [ship, shipped, thanks];

  it("empty query returns all, most-used first, title as tiebreak", () => {
    expect(rankTemplates(all, "").map((t) => t.title)).toEqual([
      "Thank you",
      "Order shipped",
      "Shipping info",
    ]);
  });

  it("exact shortcut match beats prefix match regardless of usage", () => {
    expect(rankTemplates(all, "ship").map((t) => t.shortcut)).toEqual(["ship", "shipped"]);
  });

  it("matches title prefix case-insensitively", () => {
    expect(rankTemplates(all, "ORDER")[0].title).toBe("Order shipped");
  });

  it("matches substrings last and excludes non-matches", () => {
    const result = rankTemplates(all, "you");
    expect(result.map((t) => t.title)).toEqual(["Thank you"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(rankTemplates(all, "zzz")).toEqual([]);
  });
});
