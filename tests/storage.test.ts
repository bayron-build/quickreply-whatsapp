import { describe, it, expect, beforeEach } from "vitest";
import type { Template } from "../src/lib/types";
import { DEFAULT_SETTINGS } from "../src/lib/types";

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

import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  incrementUsage,
  getSettings,
  saveSettings,
} from "../src/lib/storage";

function mk(id: string): Template {
  return { id, title: id, shortcut: "", body: "hi", createdAt: 1, usageCount: 0 };
}

beforeEach(() => backing.clear());

describe("storage", () => {
  it("getTemplates returns [] on fresh install", async () => {
    expect(await getTemplates()).toEqual([]);
  });

  it("saveTemplate inserts, then updates by id", async () => {
    await saveTemplate(mk("a"));
    await saveTemplate({ ...mk("a"), title: "renamed" });
    const all = await getTemplates();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("renamed");
  });

  it("deleteTemplate removes only the matching id", async () => {
    await saveTemplate(mk("a"));
    await saveTemplate(mk("b"));
    await deleteTemplate("a");
    expect((await getTemplates()).map((t) => t.id)).toEqual(["b"]);
  });

  it("incrementUsage bumps usageCount by 1", async () => {
    await saveTemplate(mk("a"));
    await incrementUsage("a");
    await incrementUsage("a");
    expect((await getTemplates())[0].usageCount).toBe(2);
  });

  it("getSettings falls back to defaults; saveSettings persists", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ hotkey: "Ctrl+.", language: "id" });
    expect(await getSettings()).toEqual({ hotkey: "Ctrl+.", language: "id" });
  });
});
