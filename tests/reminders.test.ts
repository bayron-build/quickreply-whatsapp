import { describe, it, expect, beforeEach } from "vitest";
import type { Reminder } from "../src/lib/types";
import { FREE_REMINDER_CAP } from "../src/lib/types";

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
  presetDueAt,
  countPending,
  canAddReminder,
  dueReminders,
  getReminders,
  saveReminder,
  setReminderStatus,
  deleteReminder,
} from "../src/lib/reminders";

function mk(id: string, status: Reminder["status"] = "pending", dueAt = 5000): Reminder {
  return { id, chatName: "Budi", note: "", dueAt, createdAt: 1, status };
}

beforeEach(() => backing.clear());

describe("presetDueAt", () => {
  const now = new Date("2026-07-11T14:30:00");

  it("1h and 3h are exact offsets", () => {
    expect(presetDueAt("1h", now)).toBe(now.getTime() + 3_600_000);
    expect(presetDueAt("3h", now)).toBe(now.getTime() + 3 * 3_600_000);
  });

  it("tomorrow9 is 09:00 local on the next calendar day", () => {
    const due = new Date(presetDueAt("tomorrow9", now));
    expect(due.getDate()).toBe(12);
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(0);
  });

  it("tomorrow9 crosses month boundaries", () => {
    const due = new Date(presetDueAt("tomorrow9", new Date("2026-07-31T22:00:00")));
    expect(due.getMonth()).toBe(7); // August
    expect(due.getDate()).toBe(1);
  });
});

describe("cap logic", () => {
  it("counts only pending reminders", () => {
    expect(countPending([mk("a"), mk("b", "fired"), mk("c", "dismissed")])).toBe(1);
  });

  it("free tier allows up to FREE_REMINDER_CAP pending", () => {
    const two = [mk("a"), mk("b")];
    expect(FREE_REMINDER_CAP).toBe(2);
    expect(canAddReminder([mk("a")], false)).toBe(true);
    expect(canAddReminder(two, false)).toBe(false);
  });

  it("fired/dismissed reminders never block creation", () => {
    expect(canAddReminder([mk("a", "fired"), mk("b", "dismissed"), mk("c")], false)).toBe(true);
  });

  it("pro is unlimited", () => {
    expect(canAddReminder([mk("a"), mk("b"), mk("c")], true)).toBe(true);
  });
});

describe("dueReminders", () => {
  it("returns pending reminders at/past dueAt only", () => {
    const rs = [mk("past", "pending", 1000), mk("future", "pending", 9000), mk("fired", "fired", 1000)];
    expect(dueReminders(rs, 5000).map((r) => r.id)).toEqual(["past"]);
  });
});

describe("reminder storage", () => {
  it("returns [] on fresh install (schema v1 → v2 migration)", async () => {
    expect(await getReminders()).toEqual([]);
  });

  it("saveReminder inserts then updates by id; stamps schemaVersion 2", async () => {
    await saveReminder(mk("a"));
    await saveReminder({ ...mk("a"), note: "changed" });
    const all = await getReminders();
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("changed");
    expect(backing.get("schemaVersion")).toBe(2);
  });

  it("setReminderStatus updates only the matching id", async () => {
    await saveReminder(mk("a"));
    await saveReminder(mk("b"));
    await setReminderStatus("a", "fired");
    const all = await getReminders();
    expect(all.find((r) => r.id === "a")?.status).toBe("fired");
    expect(all.find((r) => r.id === "b")?.status).toBe("pending");
  });

  it("deleteReminder removes only the matching id", async () => {
    await saveReminder(mk("a"));
    await saveReminder(mk("b"));
    await deleteReminder("a");
    expect((await getReminders()).map((r) => r.id)).toEqual(["b"]);
  });
});
