import { describe, it, expect } from "vitest";
import { extractPlaceholders, fillTemplate } from "../src/lib/template";

describe("extractPlaceholders", () => {
  it("finds placeholders, unique, in order of first appearance", () => {
    expect(extractPlaceholders("Hi {name}, order {order_id}. Thanks {name}!")).toEqual([
      "name",
      "order_id",
    ]);
  });

  it("returns an empty array when there are none", () => {
    expect(extractPlaceholders("Hello there")).toEqual([]);
  });

  it("ignores malformed braces", () => {
    expect(extractPlaceholders("a {not closed and {} and {bad key}")).toEqual([]);
  });
});

describe("fillTemplate", () => {
  it("replaces known variables", () => {
    expect(fillTemplate("Hi {name}!", { name: "Dina" })).toBe("Hi Dina!");
  });

  it("leaves unknown placeholders untouched for manual editing", () => {
    expect(fillTemplate("Hi {name}, ships {date}", { name: "Dina" })).toBe(
      "Hi Dina, ships {date}"
    );
  });

  it("treats empty-string values as unknown (keeps placeholder visible)", () => {
    expect(fillTemplate("Hi {name}!", { name: "" })).toBe("Hi {name}!");
  });

  it("replaces repeated occurrences", () => {
    expect(fillTemplate("{name} {name}", { name: "A" })).toBe("A A");
  });
});
