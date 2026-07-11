# QuickReply v1.1 Pro Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship QuickReply 1.1.0: follow-up reminders (background worker + notifications), Pro tier with Lemon Squeezy licensing, fill-in placeholder form, free-tier polish (multi-select delete, WhatsApp theme matching, new icon), and enforcement of the 15-template free cap.

**Architecture:** All new business logic lives in pure, unit-tested modules under `src/lib/` (reminders, license state machine, fill-form model, import cap). A new MV3 background service worker (`src/background/index.ts`) owns chrome.alarms, notifications, badge, and weekly license revalidation, and stays thin enough to review by hand. WhatsApp DOM knowledge stays quarantined in `src/content/whatsappAdapter.ts` (two new functions: `openChatByName`, `getTheme`). A single `src/lib/entitlements.ts` gate answers "is this user Pro?" for every feature.

**Tech Stack:** TypeScript, Vite (three build configs: options page, content script IIFE, background IIFE), Vitest, @types/chrome, sharp (icons). No runtime dependencies. No frameworks.

**Spec:** `docs/superpowers/specs/2026-07-11-quickreply-v1.1-pro-design.md`

## Global Constraints

- **NEVER auto-send messages.** Nothing in this codebase triggers WhatsApp message sending. `openChatByName` is pure navigation.
- **Adapter quarantine:** `src/content/whatsappAdapter.ts` is the ONLY file that may know WhatsApp's DOM.
- **Network policy (amended v1 principle):** requests ONLY to `https://api.lemonsqueezy.com/v1/licenses/*`, ONLY for license activate/validate/deactivate, ONLY when the user entered a license key. No telemetry, ever. No other endpoints.
- **Never hold data hostage:** no update ever deletes, locks, or hides existing user data. Existing reminders always fire, even after downgrade. Existing templates beyond the cap keep working forever.
- **Caps:** `FREE_TEMPLATE_CAP = 15` (blocks NEW adds/imports only), `FREE_REMINDER_CAP = 2` (pending reminders only; firing is never gated).
- **License grace:** 14 days offline grace past `lastValidatedAt`; weekly revalidation cadence.
- **Pricing is configuration, not code:** amounts exist only in the Lemon Squeezy dashboard and the two strings in `src/lib/proConfig.ts`.
- **i18n:** every user-visible string gets a key in BOTH `public/_locales/en/messages.json` and `public/_locales/id/messages.json`.
- **Testing:** TDD for all pure logic (Vitest). Background worker and UI kept thin, verified via the manual steps in each task. Tests mock `chrome.storage.local` with the Map pattern from `tests/storage.test.ts`.
- **Environment:** Windows / PowerShell. `npm test` = `vitest run`; single file = `npx vitest run tests/<file>.test.ts`. Typecheck = `npm run typecheck`. Zip must be built with the existing `npm run zip` (bsdtar), NEVER PowerShell `Compress-Archive`.
- **Commits:** one per task, message given in the task's final step.
- **Version stays 1.0.0 until Task 14** bumps everything to 1.1.0.

---

### Task 1: Reminder model, schema v2, pure reminder logic + storage

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/storage.ts` (export the `read`/`write` helpers)
- Create: `src/lib/reminders.ts`
- Create: `src/lib/entitlements.ts`
- Test: `tests/reminders.test.ts`

**Interfaces:**
- Consumes: `read<T>(key, fallback)` / `write(key, value)` from `storage.ts` (currently private — this task exports them).
- Produces (later tasks rely on these exact names):
  - `types.ts`: `Reminder`, `ReminderStatus`, `SCHEMA_VERSION = 2`, `FREE_REMINDER_CAP = 2`, `LICENSE_GRACE_MS`, `DAY_MS`, `OPEN_CHAT_MSG`, `OpenChatMessage`
  - `reminders.ts`: `presetDueAt(preset, now)`, `countPending(reminders)`, `canAddReminder(reminders, pro)`, `dueReminders(reminders, now)`, `getReminders()`, `saveReminder(r)`, `setReminderStatus(id, status)`, `deleteReminder(id)`
  - `entitlements.ts`: `isProActive(): Promise<boolean>`

- [ ] **Step 1: Add the new types and constants**

In `src/lib/types.ts`, bump the schema version, and add below the existing declarations:

```ts
export const SCHEMA_VERSION = 2; // v2 adds the "reminders" key (migration: read fallback = [])

export type ReminderStatus = "pending" | "fired" | "dismissed";

export interface Reminder {
  id: string;          // uuid; doubles as the chrome.alarms alarm name
  chatName: string;    // adapter's getChatName() at creation time
  note: string;        // optional, may be ""
  dueAt: number;       // epoch ms
  createdAt: number;
  status: ReminderStatus;
}

/** Free-tier cap on PENDING reminders. Firing is never gated. */
export const FREE_REMINDER_CAP = 2;

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Pro stays active up to this long past lastValidatedAt when validation is unreachable. */
export const LICENSE_GRACE_MS = 14 * DAY_MS;

export interface LicenseState {
  key: string;
  instanceId: string;   // Lemon Squeezy instance id from activation
  plan: string;         // display name, e.g. variant name from the provider
  status: "active" | "invalid";
  lastValidatedAt: number; // epoch ms of last successful validation
}

/** Message from background → content script: navigate to a chat (never send). */
export const OPEN_CHAT_MSG = "qr-open-chat";
export interface OpenChatMessage {
  type: typeof OPEN_CHAT_MSG;
  chatName: string;
}
```

Keep the existing `Template`, `Settings`, `FREE_TEMPLATE_CAP`, `DEFAULT_SETTINGS` exactly as they are. Update the stale comment on `FREE_TEMPLATE_CAP` to: `/** Free-tier cap. Enforced from v1.1: blocks NEW adds/imports only; existing templates are never touched. */`

In `src/lib/storage.ts`, change the two helpers from private to exported (`export async function read...`, `export async function write...`). Nothing else changes — `write` already stamps `schemaVersion`, so the 1→2 bump ships automatically with the constant.

- [ ] **Step 2: Write the failing tests**

Create `tests/reminders.test.ts` (chrome mock copied from `tests/storage.test.ts` — it must be installed BEFORE importing the module under test):

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/reminders.test.ts`
Expected: FAIL — cannot resolve `../src/lib/reminders`.

- [ ] **Step 4: Implement `src/lib/reminders.ts`**

```ts
import type { Reminder, ReminderStatus } from "./types";
import { FREE_REMINDER_CAP } from "./types";
import { read, write } from "./storage";

export type ReminderPreset = "1h" | "3h" | "tomorrow9";

export function presetDueAt(preset: ReminderPreset, now: Date): number {
  if (preset === "1h") return now.getTime() + 3_600_000;
  if (preset === "3h") return now.getTime() + 3 * 3_600_000;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function countPending(reminders: Reminder[]): number {
  return reminders.filter((r) => r.status === "pending").length;
}

/** Firing is never gated — this caps CREATION only. */
export function canAddReminder(reminders: Reminder[], pro: boolean): boolean {
  return pro || countPending(reminders) < FREE_REMINDER_CAP;
}

export function dueReminders(reminders: Reminder[], now: number): Reminder[] {
  return reminders.filter((r) => r.status === "pending" && r.dueAt <= now);
}

export async function getReminders(): Promise<Reminder[]> {
  return read<Reminder[]>("reminders", []);
}

async function setReminders(reminders: Reminder[]): Promise<void> {
  await write("reminders", reminders);
}

export async function saveReminder(r: Reminder): Promise<void> {
  const all = await getReminders();
  const i = all.findIndex((x) => x.id === r.id);
  if (i === -1) all.push(r);
  else all[i] = r;
  await setReminders(all);
}

export async function setReminderStatus(id: string, status: ReminderStatus): Promise<void> {
  const all = await getReminders();
  const r = all.find((x) => x.id === id);
  if (!r) return;
  r.status = status;
  await setReminders(all);
}

export async function deleteReminder(id: string): Promise<void> {
  await setReminders((await getReminders()).filter((r) => r.id !== id));
}
```

Create `src/lib/entitlements.ts`:

```ts
/**
 * The single gate every Pro check goes through. Until the license module
 * ships (wired in a later task), everyone is on the free tier.
 */
export async function isProActive(): Promise<boolean> {
  return false;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/reminders.test.ts` then `npm test` (nothing existing may break) and `npm run typecheck`.
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```
git add src/lib/types.ts src/lib/storage.ts src/lib/reminders.ts src/lib/entitlements.ts tests/reminders.test.ts
git commit -m "feat: reminder model, schema v2, pure reminder logic and cap"
```

---

### Task 2: Background service worker — alarms, notifications, badge, startup sweep

**Files:**
- Create: `src/background/index.ts`
- Create: `vite.background.config.ts`
- Modify: `public/manifest.json`
- Modify: `package.json` (build + zip scripts)
- Modify: `tsconfig.json` (include the new vite config)

**Interfaces:**
- Consumes: `getReminders`, `setReminderStatus`, `dueReminders` from `src/lib/reminders.ts`; `Reminder`, `OPEN_CHAT_MSG`, `OpenChatMessage` from `src/lib/types.ts`.
- Produces: `background.js` in dist. Alarm name = reminder id. Reserved alarm name `qr-license-revalidate` (constant `LICENSE_ALARM`, handler added in Task 12). Message `{ type: "qr-open-options" }` from any extension page/content script opens the options page. Notification id = reminder id.

- [ ] **Step 1: Update the manifest**

`public/manifest.json` — add permissions, explicit host permission (same origin the content script already implies; being explicit costs nothing new in review), toolbar action (required for badge APIs), and the service worker:

```json
{
  "manifest_version": 3,
  "name": "__MSG_appName__",
  "description": "__MSG_appDesc__",
  "version": "1.0.0",
  "default_locale": "en",
  "options_page": "src/options/options.html",
  "permissions": ["storage", "alarms", "notifications"],
  "host_permissions": ["https://web.whatsapp.com/*"],
  "action": {},
  "background": { "service_worker": "background.js" },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://web.whatsapp.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Write the service worker**

Create `src/background/index.ts`:

```ts
/**
 * Background service worker: owns chrome.alarms, notifications, and the
 * toolbar badge. Kept deliberately thin — all decisions live in the pure
 * functions of src/lib/reminders.ts. HARD RULE: never sends messages on
 * WhatsApp; notification click-through only NAVIGATES (see OpenChatMessage).
 */
import type { OpenChatMessage, Reminder } from "../lib/types";
import { OPEN_CHAT_MSG } from "../lib/types";
import { dueReminders, getReminders, setReminderStatus } from "../lib/reminders";

/** Reserved for weekly license revalidation (handler ships with the license task). */
const LICENSE_ALARM = "qr-license-revalidate";
const WA_URL = "https://web.whatsapp.com/";

const t = (key: string, subs?: string[]): string => chrome.i18n.getMessage(key, subs) || key;

/** One chrome.alarms alarm per pending reminder, alarm name = reminder id. */
async function reconcileAlarms(): Promise<void> {
  const reminders = await getReminders();
  const pending = reminders.filter((r) => r.status === "pending");
  const pendingIds = new Set(pending.map((r) => r.id));
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name !== LICENSE_ALARM && !pendingIds.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const r of pending) {
    chrome.alarms.create(r.id, { when: Math.max(r.dueAt, Date.now() + 1000) });
  }
}

async function updateBadge(): Promise<void> {
  const fired = (await getReminders()).filter((r) => r.status === "fired").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#008069" });
  await chrome.action.setBadgeText({ text: fired === 0 ? "" : String(fired) });
}

async function fireReminder(r: Reminder): Promise<void> {
  await setReminderStatus(r.id, "fired");
  chrome.notifications.create(r.id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: t("reminderNotifTitle", [r.chatName]),
    message: r.note,
  });
  await updateBadge();
}

/** Fire anything missed while the browser was closed, then (re)schedule the rest. */
async function sweepAndSchedule(): Promise<void> {
  const reminders = await getReminders();
  for (const r of dueReminders(reminders, Date.now())) {
    await fireReminder(r);
  }
  await reconcileAlarms();
  await updateBadge();
}

async function openWhatsAppAt(chatName: string): Promise<void> {
  const msg: OpenChatMessage = { type: OPEN_CHAT_MSG, chatName };
  const [tab] = await chrome.tabs.query({ url: WA_URL + "*" });
  if (tab?.id != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      // Content script not ready (page mid-load). WhatsApp is focused — acceptable.
    }
    return;
  }
  const created = await chrome.tabs.create({ url: WA_URL });
  // Content script loads at document_idle; retry briefly, then give up
  // (spec: tab open and focused is the acceptable fallback).
  for (let i = 0; i < 15; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    try {
      if (created.id != null) {
        await chrome.tabs.sendMessage(created.id, msg);
        return;
      }
    } catch {
      // keep retrying
    }
  }
}

async function handleNotificationClick(id: string): Promise<void> {
  chrome.notifications.clear(id);
  const r = (await getReminders()).find((x) => x.id === id);
  if (!r) return;
  await setReminderStatus(id, "dismissed");
  await updateBadge();
  await openWhatsAppAt(r.chatName);
}

async function onAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name === LICENSE_ALARM) return; // handler ships with the license task
  const r = (await getReminders()).find((x) => x.id === alarm.name && x.status === "pending");
  if (r) await fireReminder(r);
}

chrome.runtime.onInstalled.addListener(() => void sweepAndSchedule());
chrome.runtime.onStartup.addListener(() => void sweepAndSchedule());
chrome.alarms.onAlarm.addListener((alarm) => void onAlarm(alarm));
chrome.notifications.onClicked.addListener((id) => void handleNotificationClick(id));
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

// Creating/deleting reminders anywhere (picker, future UIs) reschedules alarms
// declaratively — no explicit messaging needed, survives worker restarts.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.reminders) void reconcileAlarms().then(updateBadge);
});

// Content scripts can't call openOptionsPage directly.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "qr-open-options") void chrome.runtime.openOptionsPage();
});
```

Add the notification title key to BOTH locale files:
- `public/_locales/en/messages.json`: `"reminderNotifTitle": { "message": "Follow up: $CHAT$", "placeholders": { "CHAT": { "content": "$1" } } }`
- `public/_locales/id/messages.json`: `"reminderNotifTitle": { "message": "Tindak lanjut: $CHAT$", "placeholders": { "CHAT": { "content": "$1" } } }`

- [ ] **Step 3: Wire the build**

Create `vite.background.config.ts` (mirror of the content config):

```ts
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/background/index.ts",
      formats: ["iife"],
      name: "QuickReplyBackground",
      fileName: () => "background.js",
    },
  },
});
```

In `package.json` scripts:
- `"build": "vite build && vite build --config vite.content.config.ts && vite build --config vite.background.config.ts"`
- In `"zip"`, add `background.js` to the tar file list (after `content.js`).

In `tsconfig.json`, add `"vite.background.config.ts"` to `include`.

- [ ] **Step 4: Build and typecheck**

Run: `npm run typecheck` then `npm run build`
Expected: clean; `dist/background.js` exists alongside `dist/content.js`.

- [ ] **Step 5: Manual verification (no UI exists yet — drive via the worker console)**

1. `chrome://extensions` → Load unpacked → `dist` (or Reload if already loaded).
2. Click "service worker" to open its console. Paste:
   ```js
   chrome.storage.local.get("reminders").then(({ reminders = [] }) => chrome.storage.local.set({ reminders: [...reminders, { id: crypto.randomUUID(), chatName: "Test Chat", note: "manual test", dueAt: Date.now() + 20000, createdAt: Date.now(), status: "pending" }] }));
   ```
3. Within ~30s (Chrome rounds short alarms up to its minimum): a desktop notification "Follow up: Test Chat" appears and the toolbar icon shows badge `1`.
4. Click the notification → badge clears. (Click-through navigation lands in Task 4 — for now just confirm the badge clears and no errors appear in the worker console.)
5. Repeat step 2 with `dueAt: Date.now() - 1000` and status `"pending"`, then click Reload on the extension → the missed reminder fires immediately (startup sweep).

- [ ] **Step 6: Commit**

```
git add src/background/index.ts vite.background.config.ts public/manifest.json public/_locales package.json tsconfig.json
git commit -m "feat: background service worker fires reminder alarms with notifications and badge"
```

---

### Task 3: Reminder creation flow in the picker

**Files:**
- Modify: `src/content/picker.ts`
- Modify: `src/content/index.ts`
- Modify: `public/_locales/en/messages.json`, `public/_locales/id/messages.json`

**Interfaces:**
- Consumes: `presetDueAt`, `canAddReminder`, `getReminders`, `saveReminder` (`src/lib/reminders.ts`); `isProActive` (`src/lib/entitlements.ts`); `getChatName` (adapter, via a callback from `index.ts` — picker.ts must NOT import the adapter).
- Produces: `Picker` constructor gains a third argument `getChatName: () => string | null`. Picker gains internal views `"list" | "reminder"`. The pinned row uses active index `-1`.

- [ ] **Step 1: Add i18n keys (both locales)**

en:
```json
"remindMeRow": { "message": "⏰ Remind me about this chat" },
"reminderFor": { "message": "Remind me about $CHAT$", "placeholders": { "CHAT": { "content": "$1" } } },
"preset1h": { "message": "In 1 hour" },
"preset3h": { "message": "In 3 hours" },
"presetTomorrow": { "message": "Tomorrow 09:00" },
"presetCustom": { "message": "Pick date & time" },
"reminderNotePlaceholder": { "message": "Note (optional)" },
"setReminder": { "message": "Set reminder" },
"reminderSaved": { "message": "Reminder set" },
"back": { "message": "Back" },
"reminderCapReached": { "message": "Free includes 2 active reminders. Pro makes them unlimited." },
"upgradeToPro": { "message": "Upgrade to Pro" },
"invalidTime": { "message": "Pick a time in the future." }
```

id:
```json
"remindMeRow": { "message": "⏰ Ingatkan saya tentang chat ini" },
"reminderFor": { "message": "Ingatkan saya tentang $CHAT$", "placeholders": { "CHAT": { "content": "$1" } } },
"preset1h": { "message": "1 jam lagi" },
"preset3h": { "message": "3 jam lagi" },
"presetTomorrow": { "message": "Besok 09.00" },
"presetCustom": { "message": "Pilih tanggal & waktu" },
"reminderNotePlaceholder": { "message": "Catatan (opsional)" },
"setReminder": { "message": "Pasang pengingat" },
"reminderSaved": { "message": "Pengingat terpasang" },
"back": { "message": "Kembali" },
"reminderCapReached": { "message": "Versi gratis mencakup 2 pengingat aktif. Pro membuatnya tanpa batas." },
"upgradeToPro": { "message": "Tingkatkan ke Pro" },
"invalidTime": { "message": "Pilih waktu di masa depan." }
```

- [ ] **Step 2: Extend the picker**

In `src/content/picker.ts`:

1. New imports:
```ts
import type { Reminder } from "../lib/types";
import { canAddReminder, getReminders, presetDueAt, saveReminder } from "../lib/reminders";
import type { ReminderPreset } from "../lib/reminders";
import { isProActive } from "../lib/entitlements";
```

2. Constructor gains a third parameter (after `onDismiss`): `private getChatName: () => string | null = () => null`.

3. New fields: `private view: "list" | "reminder" = "list";` and `private reminderError = "";`. `openAt` resets `this.view = "list"` before `refresh()`.

4. Append to the `CSS` constant:
```css
.qr-remind { padding: 8px 12px; cursor: pointer; color: #008069; font-weight: 600;
  border-bottom: 1px solid #e9edef; }
.qr-remind.qr-active { background: #f0f2f5; }
.qr-step { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.qr-step h3 { margin: 0; font-size: 14px; }
.qr-preset { text-align: left; border: 1px solid #d1d7db; background: #fff; border-radius: 8px;
  padding: 8px 10px; cursor: pointer; font: inherit; color: inherit; }
.qr-preset:hover { background: #f0f2f5; }
.qr-note, .qr-custom { border: 1px solid #d1d7db; border-radius: 8px; padding: 8px 10px; font: inherit; }
.qr-error { color: #c5221f; font-size: 13px; margin: 0; }
.qr-row { display: flex; gap: 8px; }
.qr-btn { border: 1px solid #d1d7db; background: #fff; border-radius: 8px; padding: 8px 12px;
  cursor: pointer; font: inherit; color: inherit; }
.qr-btn.qr-primary { background: #008069; border-color: #008069; color: #fff; }
```
(Dark-mode equivalents follow in Task 8, which reworks picker theming wholesale; the existing `prefers-color-scheme` block gains nothing here.)

5. The pinned row: in `renderList()`, before rendering matches, when `this.getChatName() !== null` prepend a reminder row that participates in keyboard navigation as index `-1`:

```ts
private renderList(): void {
  this.listEl.replaceChildren();
  const chatOpen = this.getChatName() !== null;
  if (chatOpen) {
    const row = document.createElement("div");
    row.className = "qr-remind" + (this.active === -1 ? " qr-active" : "");
    row.textContent = t("remindMeRow");
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void this.openReminderStep();
    });
    this.listEl.appendChild(row);
  }
  // ...existing empty-state and matches rendering unchanged below...
}
```

Keyboard changes in `onKey` (list view only): `ArrowUp` from index 0 goes to `-1` when a chat is open (`this.active = Math.max(this.active - 1, this.getChatName() !== null ? -1 : 0)`); `Enter` with `this.active === -1` calls `void this.openReminderStep()` instead of `pick`. `refresh()` keeps `this.active = 0` (the first template stays the default).

6. The reminder step:

```ts
private async openReminderStep(): Promise<void> {
  const reminders = await getReminders();
  const pro = await isProActive();
  this.view = "reminder";
  this.reminderError = "";
  if (!canAddReminder(reminders, pro)) {
    this.renderCapNotice();
    return;
  }
  this.renderReminderStep();
}

private renderCapNotice(): void {
  this.listEl.replaceChildren();
  const step = document.createElement("div");
  step.className = "qr-step";
  const msg = document.createElement("p");
  msg.textContent = t("reminderCapReached");
  msg.style.margin = "0";
  const upgrade = document.createElement("button");
  upgrade.className = "qr-btn qr-primary";
  upgrade.textContent = t("upgradeToPro");
  upgrade.addEventListener("mousedown", (e) => {
    e.preventDefault();
    try {
      void chrome.runtime.sendMessage({ type: "qr-open-options" });
    } catch {
      // extension context gone; nothing to do
    }
    this.dismiss();
  });
  const back = document.createElement("button");
  back.className = "qr-btn";
  back.textContent = t("back");
  back.addEventListener("mousedown", (e) => {
    e.preventDefault();
    this.backToList();
  });
  const row = document.createElement("div");
  row.className = "qr-row";
  row.append(upgrade, back);
  step.append(msg, row);
  this.listEl.appendChild(step);
}

private renderReminderStep(): void {
  this.listEl.replaceChildren();
  const chatName = this.getChatName() ?? "";
  const step = document.createElement("div");
  step.className = "qr-step";

  const heading = document.createElement("h3");
  heading.textContent = t("reminderFor", [chatName]);

  const note = document.createElement("input");
  note.className = "qr-note";
  note.placeholder = t("reminderNotePlaceholder");
  note.maxLength = 120;

  const presets: Array<[ReminderPreset, string]> = [
    ["1h", t("preset1h")],
    ["3h", t("preset3h")],
    ["tomorrow9", t("presetTomorrow")],
  ];
  const presetBtns = presets.map(([preset, label]) => {
    const b = document.createElement("button");
    b.className = "qr-preset";
    b.textContent = label;
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void this.createReminder(chatName, presetDueAt(preset, new Date()), note.value.trim());
    });
    return b;
  });

  const custom = document.createElement("input");
  custom.type = "datetime-local";
  custom.className = "qr-custom";

  const error = document.createElement("p");
  error.className = "qr-error";
  error.textContent = this.reminderError;

  const set = document.createElement("button");
  set.className = "qr-btn qr-primary";
  set.textContent = t("setReminder");
  set.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const when = custom.value ? new Date(custom.value).getTime() : NaN;
    if (!Number.isFinite(when) || when <= Date.now()) {
      this.reminderError = t("invalidTime");
      this.renderReminderStep();
      return;
    }
    void this.createReminder(chatName, when, note.value.trim());
  });

  const back = document.createElement("button");
  back.className = "qr-btn";
  back.textContent = t("back");
  back.addEventListener("mousedown", (e) => {
    e.preventDefault();
    this.backToList();
  });

  const row = document.createElement("div");
  row.className = "qr-row";
  row.append(set, back);
  step.append(heading, note, ...presetBtns, custom, error, row);
  this.listEl.appendChild(step);
  note.focus();
}

private backToList(): void {
  this.view = "list";
  this.reminderError = "";
  this.refresh();
  this.input.focus();
}

private async createReminder(chatName: string, dueAt: number, note: string): Promise<void> {
  const r: Reminder = {
    id: crypto.randomUUID(),
    chatName,
    note,
    dueAt,
    createdAt: Date.now(),
    status: "pending",
  };
  try {
    await saveReminder(r);
  } catch {
    // storage failed; leave the step open so the user can retry
    return;
  }
  this.dismiss();
}
```

7. Esc handling. The global capture-phase keydown in `index.ts` runs BEFORE any picker-internal listener and calls `stopPropagation`, so the picker cannot intercept Esc itself — instead, expose a public method and let `index.ts` delegate:

```ts
/** Esc semantics: second-step views return to the list; list view closes. */
escape(): "closed" | "handled" {
  if (this.view !== "list") {
    this.backToList();
    return "handled";
  }
  this.close();
  return "closed";
}
```

In `src/content/index.ts`, the Escape branch of the global keydown becomes:

```ts
    if (e.key === "Escape" && picker.isOpen) {
      e.preventDefault();
      e.stopPropagation();
      if (picker.escape() === "closed") getComposeBox()?.focus();
      return;
    }
```

(The Ctrl+/ toggle branch keeps calling `picker.close()` — toggling off always closes outright.) The existing Escape case inside `onKey` stays as a fallback for the orphaned-context case where the content-script handler may be gone.

8. Hide the search input outside list view: first line of `renderCapNotice()` and `renderReminderStep()` is `this.input.hidden = true;`; `backToList()` sets `this.input.hidden = false;` before `refresh()`.

- [ ] **Step 3: Pass the chat-name callback**

In `src/content/index.ts`, the `Picker` construction becomes:

```ts
const picker = new Picker(
  (tpl: Template) => {
    void insertTemplate(tpl);
  },
  () => getComposeBox()?.focus(),
  () => getChatName()
);
```

- [ ] **Step 4: Typecheck, build, manual verification**

Run: `npm run typecheck && npm run build`, reload the unpacked extension, refresh WhatsApp Web.

1. Open a chat → `Ctrl+/` → the "⏰ Remind me about this chat" row shows above templates.
2. ArrowUp from the first template highlights the row; Enter opens the step; Esc returns to the list; Esc again closes the picker.
3. "In 1 hour" with a note → picker closes; the worker console shows the alarm (`chrome.alarms.getAll(console.log)`).
4. Custom picker with a past time → inline "Pick a time in the future."; a time 2 minutes out → notification fires with chat name + note, badge shows 1.
5. Create 2 pending reminders, try a third → cap notice with Upgrade + Back; Upgrade opens the options page (free tier: `isProActive()` is false for everyone until the license task).
6. Set the browser language to Indonesian (or spot-check `id` keys) — strings resolve.

- [ ] **Step 5: Commit**

```
git add src/content/picker.ts src/content/index.ts public/_locales
git commit -m "feat: reminder creation flow in picker with presets, note, and free cap"
```

---

### Task 4: Notification click-through opens the reminded chat

**Files:**
- Modify: `src/content/whatsappAdapter.ts`
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `OPEN_CHAT_MSG`, `OpenChatMessage` from `src/lib/types.ts`; background already sends the message (Task 2's `openWhatsAppAt`).
- Produces: adapter `openChatByName(name: string): boolean` — pure navigation, returns whether a matching sidebar row was found and clicked. NEVER sends messages.

- [ ] **Step 1: Add `openChatByName` to the adapter**

In `src/content/whatsappAdapter.ts`, add to `SELECTORS`:

```ts
  // Sidebar chat rows: each row contains a span[title="<chat name>"].
  // (In the chat LIST the title attribute is present — unlike the #main
  // header, where it is absent; both verified live 2026-07-10/11.)
  sidebarChatTitle: "#pane-side span[title]",
```

Add the function:

```ts
/**
 * Navigate to a chat by clicking its sidebar row. PURE NAVIGATION — this
 * must never touch the compose box or send anything. Only chats currently
 * rendered in the (virtualized) sidebar are findable; returns false
 * otherwise and the caller treats that as an acceptable fallback.
 */
export function openChatByName(name: string): boolean {
  const spans = document.querySelectorAll<HTMLElement>(SELECTORS.sidebarChatTitle);
  for (const span of spans) {
    if (span.getAttribute("title") === name) {
      const row = span.closest<HTMLElement>('[role="listitem"]') ?? span;
      for (const type of ["mousedown", "mouseup", "click"]) {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Listen for the message in the content script**

In `src/content/index.ts`, import `openChatByName` from the adapter and `OPEN_CHAT_MSG` plus `OpenChatMessage` from `../lib/types`, then add at the bottom:

```ts
// Background → content: navigate to a reminded chat. Retries briefly because
// right after a fresh tab opens, the sidebar may not be rendered yet.
chrome.runtime.onMessage.addListener((msg: OpenChatMessage) => {
  if (msg?.type !== OPEN_CHAT_MSG) return;
  let attempts = 0;
  const tryOpen = (): void => {
    attempts += 1;
    if (openChatByName(msg.chatName) || attempts >= 10) return;
    setTimeout(tryOpen, 1000);
  };
  tryOpen();
});
```

- [ ] **Step 3: Typecheck, build, manual verification**

Run: `npm run typecheck && npm run build`, reload extension, refresh WhatsApp Web.

1. Set a 2-minute reminder on a chat, open a different chat, wait for the notification, click it → the WhatsApp tab is focused AND the reminded chat opens. Badge clears.
2. Close the WhatsApp tab entirely, fire another reminder (worker console trick from Task 2), click the notification → a new tab opens, and once loaded the chat is selected.
3. Set a reminder, then rename/archive scenario stand-in: reminder for a chat scrolled far out of the sidebar → click notification → WhatsApp focuses, no chat switch, no console errors (acceptable fallback).

- [ ] **Step 4: Commit**

```
git add src/content/whatsappAdapter.ts src/content/index.ts
git commit -m "feat: notification click-through navigates to the reminded chat"
```

---

### Task 5: Fill-in form pure model

**Files:**
- Create: `src/lib/fillForm.ts`
- Test: `tests/fillForm.test.ts`

**Interfaces:**
- Consumes: `extractPlaceholders` from `src/lib/template.ts`.
- Produces: `FillField { key: string; value: string; auto: boolean }`, `buildFillFields(body, autoVars): FillField[]`, `needsFillForm(fields): boolean`. Final text assembly reuses the existing `fillTemplate(body, vars)` — no new assembler.

- [ ] **Step 1: Write the failing tests**

Create `tests/fillForm.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fillForm.test.ts`
Expected: FAIL — cannot resolve `../src/lib/fillForm`.

- [ ] **Step 3: Implement `src/lib/fillForm.ts`**

```ts
import { extractPlaceholders } from "./template";

export interface FillField {
  key: string;
  /** Pre-filled value for auto placeholders; "" for ones the user must type. */
  value: string;
  /** True when the system can fill it ({name}, {today}, …) — shown greyed, overridable. */
  auto: boolean;
}

export function buildFillFields(body: string, autoVars: Record<string, string>): FillField[] {
  return extractPlaceholders(body).map((key) => {
    const auto = key in autoVars;
    return { key, value: auto ? autoVars[key] : "", auto };
  });
}

export function needsFillForm(fields: FillField[]): boolean {
  return fields.some((f) => !f.auto);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fillForm.test.ts` then `npm test && npm run typecheck`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add src/lib/fillForm.ts tests/fillForm.test.ts
git commit -m "feat: fill-in form pure model (placeholders to fields)"
```

---

### Task 6: Fill-in placeholder form in the picker (Pro)

**Files:**
- Modify: `src/content/picker.ts`
- Modify: `src/content/index.ts`
- Modify: `public/_locales/en/messages.json`, `public/_locales/id/messages.json`

**Interfaces:**
- Consumes: `buildFillFields`, `needsFillForm`, `FillField` (`src/lib/fillForm.ts`); `isProActive` (entitlements); `fillTemplate`, `systemPlaceholders` (existing libs).
- Produces: `Picker` constructor gains two more arguments — `getFillFields: (tpl: Template) => Promise<FillField[] | null>` (null ⇒ insert directly, v1 behavior) and `onFillSubmit: (tpl: Template, values: Record<string, string>) => void`. Picker view union becomes `"list" | "reminder" | "fill"`.

- [ ] **Step 1: Add i18n keys (both locales)**

en: `"fillFormTitle": { "message": "Fill in the blanks" }`, `"insert": { "message": "Insert" }`
id: `"fillFormTitle": { "message": "Isi bagian kosong" }`, `"insert": { "message": "Sisipkan" }`

- [ ] **Step 2: Route selection through the fill decision**

In `src/content/index.ts`:

```ts
import { buildFillFields, needsFillForm } from "../lib/fillForm";
import { isProActive } from "../lib/entitlements";
```

Extract the auto-vars so insert and form share one source:

```ts
function autoVars(): Record<string, string> {
  return { ...systemPlaceholders(new Date(), navigator.language), name: getChatName() ?? "" };
}
```

`insertTemplate` uses it (`fillTemplate(tpl.body, autoVars())`; delete the now-duplicated lines) and gains an optional override used by the form path:

```ts
async function insertTemplate(tpl: Template, values?: Record<string, string>): Promise<void> {
  const text = fillTemplate(tpl.body, values ?? autoVars());
  // ...rest unchanged (savedCaret, insertText, incrementUsage, toast)...
}
```

Picker construction gains the two new callbacks:

```ts
const picker = new Picker(
  (tpl: Template) => {
    void insertTemplate(tpl);
  },
  () => getComposeBox()?.focus(),
  () => getChatName(),
  async (tpl: Template) => {
    // Pro-only: decide whether this template needs the fill-in step.
    if (!(await isProActive())) return null;
    const fields = buildFillFields(tpl.body, autoVars());
    return needsFillForm(fields) ? fields : null;
  },
  (tpl: Template, values: Record<string, string>) => {
    void insertTemplate(tpl, values);
  }
);
```

- [ ] **Step 3: The form view in the picker**

In `src/content/picker.ts`:

1. Import `FillField` type: `import type { FillField } from "../lib/fillForm";`
2. Constructor appends two parameters after `getChatName`:
```ts
private getFillFields: (tpl: Template) => Promise<FillField[] | null> = async () => null,
private onFillSubmit: (tpl: Template, values: Record<string, string>) => void = () => {}
```
3. `view` union gains `"fill"`. New field `private fillTpl: Template | null = null;`
4. Replace `pick()`:

```ts
private pick(index: number): void {
  const tpl = this.matches[index];
  if (!tpl) return;
  void this.getFillFields(tpl).then((fields) => {
    if (!fields) {
      this.close();
      this.onSelect(tpl);
      return;
    }
    this.fillTpl = tpl;
    this.view = "fill";
    this.renderFillForm(fields);
  });
}
```

5. The form (Tab between inputs is native; Enter anywhere submits; Esc returns to the list):

```ts
private renderFillForm(fields: FillField[]): void {
  this.listEl.replaceChildren();
  const tpl = this.fillTpl;
  if (!tpl) return;
  const step = document.createElement("div");
  step.className = "qr-step";
  const heading = document.createElement("h3");
  heading.textContent = t("fillFormTitle");
  step.appendChild(heading);

  const inputs = new Map<string, HTMLInputElement>();
  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "qr-fill-label";
    const caption = document.createElement("span");
    caption.textContent = `{${field.key}}`;
    const input = document.createElement("input");
    input.className = "qr-note" + (field.auto ? " qr-prefilled" : "");
    input.value = field.value;
    if (field.auto) {
      // Greyed until the user overrides it.
      input.addEventListener("input", () => input.classList.remove("qr-prefilled"), { once: true });
    }
    inputs.set(field.key, input);
    label.append(caption, input);
    step.appendChild(label);
  }

  const submit = (): void => {
    const values: Record<string, string> = {};
    for (const [key, input] of inputs) values[key] = input.value;
    const chosen = this.fillTpl;
    this.close();
    if (chosen) this.onFillSubmit(chosen, values);
  };

  step.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  });

  const insert = document.createElement("button");
  insert.className = "qr-btn qr-primary";
  insert.textContent = t("insert");
  insert.addEventListener("mousedown", (e) => {
    e.preventDefault();
    submit();
  });
  const back = document.createElement("button");
  back.className = "qr-btn";
  back.textContent = t("back");
  back.addEventListener("mousedown", (e) => {
    e.preventDefault();
    this.fillTpl = null;
    this.backToList();
  });
  const row = document.createElement("div");
  row.className = "qr-row";
  row.append(insert, back);
  step.appendChild(row);
  this.listEl.appendChild(step);
  // Focus the first blank the user must fill, else the first input.
  const firstBlank = fields.find((f) => !f.auto);
  (firstBlank ? inputs.get(firstBlank.key) : [...inputs.values()][0])?.focus();
}
```

6. CSS additions:
```css
.qr-fill-label { display: flex; flex-direction: column; gap: 3px; }
.qr-fill-label span { font-family: monospace; font-size: 12px; color: #667781; }
.qr-prefilled { color: #8696a0; }
```

7. Esc handling: Task 3's `escape()` already covers this view (it checks `this.view !== "list"`); just extend `backToList()` to also clear `this.fillTpl = null`.

8. `renderFillForm` starts with `this.input.hidden = true;` (same as the reminder step). `close()` resets `this.view = "list"` and `this.fillTpl = null` (so a reopened picker never resumes a stale form).

- [ ] **Step 4: Typecheck, build, manual verification**

Run: `npm run typecheck && npm run build`.

Entitlements still return `false` for everyone, so first verify the FREE path: reload, insert a template containing `{tracking}` → v1 behavior, literal `{tracking}` inserted.

Then TEMPORARILY (do not commit) change `isProActive` in `src/lib/entitlements.ts` to `return true;`, rebuild, reload:
1. Template `Hi {name}, order {tracking}, total {total}, see you {today}` → picker slides to the form: `{name}` and `{today}` pre-filled grey, `{tracking}`/`{total}` empty; first blank focused.
2. Tab moves between fields; typing in a grey field un-greys it.
3. Enter → completed text inserted at the saved caret (type something in the compose box first, move the caret mid-text, then insert).
4. Esc from the form → back to the template list.
5. A template with only auto placeholders inserts directly (no form).

REVERT `entitlements.ts` to `return false;`, rebuild, confirm the free path once more.

- [ ] **Step 5: Commit**

```
git add src/content/picker.ts src/content/index.ts public/_locales
git commit -m "feat: fill-in placeholder form in picker (Pro), free tier keeps v1 behavior"
```

Verify before committing: `git diff --staged src/lib/entitlements.ts` shows nothing.

---

### Task 7: Options polish — multi-select delete + notification health warning

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/options/options.ts`, `src/options/options.html`, `src/options/options.css`
- Modify: `public/_locales/en/messages.json`, `public/_locales/id/messages.json`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Produces: `deleteTemplates(ids: string[]): Promise<void>` in `storage.ts` (single write).

- [ ] **Step 1: Write the failing test**

Append to the `describe("storage", ...)` block in `tests/storage.test.ts` (add `deleteTemplates` to the import list):

```ts
  it("deleteTemplates removes all matching ids in one write", async () => {
    await saveTemplate(mk("a"));
    await saveTemplate(mk("b"));
    await saveTemplate(mk("c"));
    await deleteTemplates(["a", "c"]);
    expect((await getTemplates()).map((t) => t.id)).toEqual(["b"]);
  });
```

Run: `npx vitest run tests/storage.test.ts` — Expected: FAIL (no export `deleteTemplates`).

- [ ] **Step 2: Implement and pass**

In `src/lib/storage.ts`, below `deleteTemplate`:

```ts
export async function deleteTemplates(ids: string[]): Promise<void> {
  const doomed = new Set(ids);
  await setTemplates((await getTemplates()).filter((t) => !doomed.has(t.id)));
}
```

Run: `npx vitest run tests/storage.test.ts` — Expected: PASS.

- [ ] **Step 3: The options UI**

i18n keys — en:
```json
"deleteSelected": { "message": "Delete selected ($N$)", "placeholders": { "N": { "content": "$1" } } },
"deleteSelectedConfirm": { "message": "Delete $N$ templates? This cannot be undone.", "placeholders": { "N": { "content": "$1" } } }
```
id:
```json
"deleteSelected": { "message": "Hapus yang dipilih ($N$)", "placeholders": { "N": { "content": "$1" } } },
"deleteSelectedConfirm": { "message": "Hapus $N$ template? Tindakan ini tidak bisa dibatalkan.", "placeholders": { "N": { "content": "$1" } } }
```

`options.html`: after the `<ul id="list"></ul>` line add:
```html
<button id="delete-selected" class="danger" hidden></button>
```

`options.css`: add `li input[type="checkbox"] { margin: 0; }` and `#delete-selected { margin-bottom: 0.6rem; }`.

`options.ts`:
1. Import `deleteTemplates` from `../lib/storage`.
2. Module state: `const selected = new Set<string>();` and `const deleteSelectedBtn = $<HTMLButtonElement>("#delete-selected");`
3. In `render()`, prune stale ids first (`for (const id of [...selected]) if (!templates.some((t) => t.id === id)) selected.delete(id);`), and prepend a checkbox to each `li`:
```ts
const check = document.createElement("input");
check.type = "checkbox";
check.checked = selected.has(tpl.id);
check.addEventListener("change", () => {
  if (check.checked) selected.add(tpl.id);
  else selected.delete(tpl.id);
  updateDeleteSelected();
});
li.prepend(check);
```
4. After the `list.replaceChildren(...)` call in `render()`, call `updateDeleteSelected()`:
```ts
function updateDeleteSelected(): void {
  deleteSelectedBtn.hidden = selected.size === 0;
  deleteSelectedBtn.textContent = t("deleteSelected", [String(selected.size)]);
}
```
5. Handler:
```ts
deleteSelectedBtn.addEventListener("click", async () => {
  if (!window.confirm(t("deleteSelectedConfirm", [String(selected.size)]))) return;
  try {
    await deleteTemplates([...selected]);
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  selected.clear();
  await render();
});
```

- [ ] **Step 4: Surface disabled notifications (spec: permission anomalies surface in the options page, never in the content script)**

Reminders silently degrade to badge-only when Chrome-level notifications are off — tell the user here, the only place we own UI chrome. i18n keys — en: `"notifDisabledWarning": { "message": "Chrome notifications are disabled, so reminders can only show a badge on the toolbar icon. Enable notifications for Chrome in your system settings to see reminder popups." }`; id: `"notifDisabledWarning": { "message": "Notifikasi Chrome dinonaktifkan, jadi pengingat hanya bisa tampil sebagai angka di ikon toolbar. Aktifkan notifikasi Chrome di pengaturan sistem untuk melihat popup pengingat." }`.

`options.html`, right under `<p id="count" ...>`:
```html
<p id="notif-warning" class="muted" hidden data-i18n="notifDisabledWarning"></p>
```

`options.ts`, at the bottom with the other init calls (callback form — works across @types/chrome versions):
```ts
chrome.notifications.getPermissionLevel((level) => {
  if (level === "denied") $("#notif-warning").hidden = false;
});
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`. Reload, open options:
1. Checking rows reveals "Delete selected (N)" with a live count; unchecking all hides it.
2. Delete 2 of 4 templates → one confirm dialog, both gone, others untouched, button hidden again.
3. Cancel on the confirm leaves everything unchanged.
4. Notification warning stays hidden normally; with Chrome notifications blocked in Windows settings (Settings → System → Notifications → Google Chrome off, then reopen options) the warning appears.

- [ ] **Step 6: Commit**

```
git add src/lib/storage.ts src/options tests/storage.test.ts public/_locales
git commit -m "feat: multi-select delete and disabled-notification warning in options"
```

---

### Task 8: Picker follows WhatsApp's theme

**Files:**
- Modify: `src/content/whatsappAdapter.ts`
- Modify: `src/content/picker.ts`

**Interfaces:**
- Produces: adapter `getTheme(): "light" | "dark" | null` (null = undeterminable → caller falls back to `prefers-color-scheme`). Options page intentionally keeps following the system (unchanged).

- [ ] **Step 1: Add `getTheme` to the adapter**

```ts
/**
 * WhatsApp's own theme, so the picker can match it even when it differs
 * from the OS theme. WhatsApp marks dark mode with a "dark" class on
 * <html> or <body> (verify live during QA — quarantine rule: if this
 * breaks, fix the check here and nothing else). Returns null before the
 * app has rendered.
 */
export function getTheme(): "light" | "dark" | null {
  if (!isWhatsAppLoaded()) return null;
  const dark =
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark");
  return dark ? "dark" : "light";
}
```

- [ ] **Step 2: Class-based theming in the picker**

In `src/content/picker.ts`:

1. Convert the `@media (prefers-color-scheme: dark)` block in `CSS` to class-scoped rules — every selector inside it becomes descendant-of-`.qr-dark`, e.g.:
```css
.qr-panel.qr-dark { background: #233138; color: #e9edef; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
.qr-dark .qr-input { background: transparent; color: inherit; border-bottom-color: #2a3942; }
.qr-dark .qr-input::placeholder { color: #8696a0; }
.qr-dark .qr-item.qr-active { background: #182229; }
.qr-dark .qr-item .qr-shortcut { color: #06cf9c; }
.qr-dark .qr-item .qr-body { color: #8696a0; }
.qr-dark .qr-empty { color: #8696a0; }
```
and add dark variants for the Task 3/6 additions:
```css
.qr-dark .qr-remind { border-bottom-color: #2a3942; color: #06cf9c; }
.qr-dark .qr-remind.qr-active { background: #182229; }
.qr-dark .qr-preset, .qr-dark .qr-btn { background: transparent; border-color: #3b4a54; color: #e9edef; }
.qr-dark .qr-preset:hover { background: #182229; }
.qr-dark .qr-btn.qr-primary { background: #008069; border-color: #008069; color: #fff; }
.qr-dark .qr-note, .qr-dark .qr-custom { background: #2a3942; border-color: #3b4a54; color: #e9edef; }
.qr-dark .qr-error { color: #f28b82; }
.qr-dark .qr-fill-label span { color: #8696a0; }
.qr-dark .qr-prefilled { color: #667781; }
```
Delete the `@media` wrapper entirely.

2. Picker must not import the adapter (quarantine flows through `index.ts`): constructor gains a final parameter `private getTheme: () => "light" | "dark" | null = () => null`. In `openAt`, right after `this.panel.className = "qr-panel"`:

```ts
const theme = this.getTheme();
const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
this.panel.classList.toggle("qr-dark", dark);
```

3. In `src/content/index.ts`, import `getTheme` from the adapter and pass `() => getTheme()` as the final constructor argument.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`. Reload, and on live WhatsApp Web check all four combinations (WhatsApp Settings → Theme light/dark × OS light/dark): the picker always matches WHATSAPP, not the OS. If the `dark` class assumption fails on the current WhatsApp build, fix the check inside `getTheme` only, and note what you found in the adapter comment.

- [ ] **Step 4: Commit**

```
git add src/content/whatsappAdapter.ts src/content/picker.ts src/content/index.ts
git commit -m "feat: picker matches WhatsApp theme via adapter getTheme"
```

---

### Task 9: Icon refresh

**Files:**
- Modify: `scripts/make-icons.mjs`
- Regenerate: `public/icons/icon16.png`, `public/icons/icon48.png`, `public/icons/icon128.png`

**Interfaces:** none (pure asset change). ⚠️ Bayu must visually approve the PNGs at this task's review checkpoint — icon taste is his call, and iterations happen here.

- [ ] **Step 1: Replace the SVG mark**

The v1 icon is placeholder text-lines. New mark: a white speech bubble on the brand-green tile with a bold lightning bolt cut into it — "instant reply". Flat, two colors, no strokes, reads at 16×16. Replace the `svg` constant in `scripts/make-icons.mjs`:

```js
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#008069"/>
  <path d="M64 22c-26 0-46 17-46 38 0 12 7 23 18 30l-4 18 20-10c4 .7 8 1 12 1 26 0 46-17 46-39s-20-38-46-38z" fill="#fff"/>
  <path d="M70 34 48 66h14l-8 26 28-38H66l10-20z" fill="#008069"/>
</svg>`;
```

- [ ] **Step 2: Regenerate and inspect**

Run: `node scripts/make-icons.mjs`
Expected: three "iconN.png written" lines. Open all three PNGs and check: bolt legible at 16px, bubble not clipped, no artifacts. Then `npm run build` and reload — check the toolbar icon and `chrome://extensions` tile.

- [ ] **Step 3: Commit (after Bayu's visual OK at review)**

```
git add scripts/make-icons.mjs public/icons
git commit -m "feat: new icon - speech bubble with lightning bolt"
```

---

### Task 10: License state machine + Lemon Squeezy client

**Files:**
- Create: `src/lib/license.ts`
- Test: `tests/license.test.ts`

**Interfaces:**
- Consumes: `LicenseState`, `LICENSE_GRACE_MS`, `DAY_MS` from `types.ts`; `read`/`write` from `storage.ts`.
- Produces (exact names later tasks use):
  - Pure: `proView(state, now): "free" | "active" | "offline" | "invalid"`, `isPro(state, now): boolean`, `applyValidation(state, outcome, now): LicenseState`, `type ValidationOutcome = "valid" | "invalid" | "unreachable"`
  - Network (the ONLY file that knows Lemon Squeezy): `activateLicense(key, now?): Promise<ActivateResult>`, `revalidateLicense(state): Promise<ValidationOutcome>`, `deactivateLicense(state): Promise<void>`
  - Storage: `getLicense(): Promise<LicenseState | null>`, `saveLicense(state: LicenseState | null): Promise<void>`
  - `type ActivateResult = { ok: true; state: LicenseState } | { ok: false; error: "invalid-key" | "network" }`

- [ ] **Step 1: Write the failing tests (pure machine + storage only; the fetch wrapper stays untested per spec — thin enough to review by hand)**

Create `tests/license.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/license.test.ts`
Expected: FAIL — cannot resolve `../src/lib/license`.

- [ ] **Step 3: Implement `src/lib/license.ts`**

Before writing the fetch wrapper, verify the endpoint/response shapes against the current Lemon Squeezy License API docs (https://docs.lemonsqueezy.com/help/licensing/license-api) — the shapes below are from those docs as of 2026-07; if they differ, the docs win (and only this file changes).

```ts
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

async function post(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

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
  if (!data.activated || typeof data.instance?.id !== "string") {
    return { ok: false, error: "invalid-key" };
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
    return data.valid === true ? "valid" : "invalid";
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/license.test.ts` then `npm test && npm run typecheck`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add src/lib/license.ts tests/license.test.ts
git commit -m "feat: license state machine with 14-day grace and Lemon Squeezy client"
```

---

### Task 11: Pro upgrade + license UI in options

**Files:**
- Create: `src/lib/proConfig.ts`
- Modify: `src/options/options.html`, `src/options/options.ts`, `src/options/options.css`
- Modify: `public/_locales/en/messages.json`, `public/_locales/id/messages.json`

**Interfaces:**
- Consumes: `proView`, `activateLicense`, `deactivateLicense`, `getLicense`, `saveLicense` from `license.ts`.
- Produces: `proConfig.ts` exports `CHECKOUT_URL: string`, `PRICE_DISPLAY: string`. Options page section `#pro` (the anchor target the cap counter links to in Task 13).
- **Human step (Bayu, during this task):** create the Lemon Squeezy account + store + "QuickReply Pro" product in TEST MODE with monthly/yearly variants (dashboard prices, e.g. $3/mo, $25/yr — spec: pricing is configuration), generate a license-key-enabled product, then paste the checkout URL and price string into `proConfig.ts`. Until then both stay `""` and the upgrade button is hidden — everything else is still testable with a test-mode key.

- [ ] **Step 1: `src/lib/proConfig.ts`**

```ts
/**
 * Pricing lives in the Lemon Squeezy dashboard, not in code. These two
 * strings are the only place the extension knows anything about money.
 * Empty CHECKOUT_URL hides the upgrade button (pre-launch state).
 */
export const CHECKOUT_URL = "";
export const PRICE_DISPLAY = "";
```

- [ ] **Step 2: i18n keys (both locales)**

en:
```json
"proTitle": { "message": "QuickReply Pro" },
"proPitch": { "message": "Unlimited templates, unlimited reminders, and the fill-in form for placeholders." },
"proStatusFree": { "message": "Free plan" },
"proStatusActive": { "message": "Pro active — $PLAN$", "placeholders": { "PLAN": { "content": "$1" } } },
"proStatusOffline": { "message": "Pro active (offline — will revalidate when the license server is reachable)" },
"proStatusInvalid": { "message": "Pro is paused: the license could not be verified. Everything you saved is untouched, and existing reminders still fire." },
"upgradeButton": { "message": "Upgrade to Pro — $PRICE$", "placeholders": { "PRICE": { "content": "$1" } } },
"licenseLabel": { "message": "License key (from your purchase email)" },
"activate": { "message": "Activate" },
"deactivate": { "message": "Deactivate on this device" },
"licenseErrorInvalid": { "message": "That key was not accepted. Check for typos and try again." },
"licenseErrorNetwork": { "message": "Could not reach the license server. Try again in a moment." }
```
id:
```json
"proTitle": { "message": "QuickReply Pro" },
"proPitch": { "message": "Template tanpa batas, pengingat tanpa batas, dan formulir isian untuk placeholder." },
"proStatusFree": { "message": "Paket gratis" },
"proStatusActive": { "message": "Pro aktif — $PLAN$", "placeholders": { "PLAN": { "content": "$1" } } },
"proStatusOffline": { "message": "Pro aktif (offline — validasi ulang saat server lisensi terjangkau)" },
"proStatusInvalid": { "message": "Pro dijeda: lisensi tidak dapat diverifikasi. Semua data Anda utuh, dan pengingat yang ada tetap berbunyi." },
"upgradeButton": { "message": "Tingkatkan ke Pro — $PRICE$", "placeholders": { "PRICE": { "content": "$1" } } },
"licenseLabel": { "message": "Kunci lisensi (dari email pembelian Anda)" },
"activate": { "message": "Aktifkan" },
"deactivate": { "message": "Nonaktifkan di perangkat ini" },
"licenseErrorInvalid": { "message": "Kunci tidak diterima. Periksa kesalahan ketik lalu coba lagi." },
"licenseErrorNetwork": { "message": "Tidak bisa terhubung ke server lisensi. Coba lagi sebentar lagi." }
```

- [ ] **Step 3: Markup + styles**

`options.html`, before the final `<hr />`:

```html
<hr />
<section id="pro">
  <h2 data-i18n="proTitle"></h2>
  <p class="muted" data-i18n="proPitch"></p>
  <p id="pro-status"></p>
  <a id="upgrade" class="button-link" target="_blank" rel="noopener" hidden></a>
  <div id="license-entry">
    <label><span data-i18n="licenseLabel"></span><input id="f-license" autocomplete="off" /></label>
    <button id="activate" class="primary" data-i18n="activate"></button>
  </div>
  <button id="deactivate" data-i18n="deactivate" hidden></button>
  <p id="license-error" class="error" role="alert"></p>
</section>
```

`options.css`:
```css
h2 { font-size: 1.1rem; margin-bottom: 0.2rem; }
.error { color: #c5221f; font-size: 0.85rem; }
.button-link { display: inline-block; background: #008069; color: #fff; border-radius: 8px;
  padding: 0.45rem 0.9rem; text-decoration: none; font-size: 0.9rem; margin-bottom: 0.6rem; }
#pro-status { font-weight: 600; }
```
(and in the dark block: `.error { color: #f28b82; }`.)

- [ ] **Step 4: Wire it in `options.ts`**

Imports:
```ts
import type { LicenseState } from "../lib/types";
import { proView, activateLicense, deactivateLicense, getLicense, saveLicense } from "../lib/license";
import { CHECKOUT_URL, PRICE_DISPLAY } from "../lib/proConfig";
```

Elements and rendering:
```ts
const proStatus = $("#pro-status");
const upgradeLink = $<HTMLAnchorElement>("#upgrade");
const licenseEntry = $("#license-entry");
const fLicense = $<HTMLInputElement>("#f-license");
const deactivateBtn = $<HTMLButtonElement>("#deactivate");
const licenseError = $("#license-error");

async function renderPro(): Promise<void> {
  const state = await getLicense();
  const view = proView(state, Date.now());
  const statusText: Record<typeof view, string> = {
    free: t("proStatusFree"),
    active: t("proStatusActive", [state?.plan ?? "Pro"]),
    offline: t("proStatusOffline"),
    invalid: t("proStatusInvalid"),
  };
  proStatus.textContent = statusText[view];
  const showBuy = view === "free" || view === "invalid";
  upgradeLink.hidden = !showBuy || CHECKOUT_URL === "";
  if (!upgradeLink.hidden) {
    upgradeLink.href = CHECKOUT_URL;
    upgradeLink.textContent = t("upgradeButton", [PRICE_DISPLAY]);
  }
  licenseEntry.hidden = !showBuy;
  deactivateBtn.hidden = showBuy;
}

$("#activate").addEventListener("click", async () => {
  const key = fLicense.value.trim();
  if (key === "") return;
  licenseError.textContent = "";
  const result = await activateLicense(key);
  if (!result.ok) {
    // Invalid/garbled key or network trouble: clear inline error, nothing stored.
    licenseError.textContent = t(
      result.error === "invalid-key" ? "licenseErrorInvalid" : "licenseErrorNetwork"
    );
    return;
  }
  try {
    await saveLicense(result.state);
  } catch (err) {
    status.textContent = String(err);
    return;
  }
  fLicense.value = "";
  await renderPro();
  await render(); // Task 13 makes the template counter license-aware
});

deactivateBtn.addEventListener("click", async () => {
  const state = await getLicense();
  if (state) void deactivateLicense(state); // best-effort, fire and forget
  try {
    await saveLicense(null);
  } catch (err) {
    status.textContent = String(err);
    return;
  }
  await renderPro();
  await render();
});
```

At the bottom, alongside `void render();` add `void renderPro();`.

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`. Reload, open options:
1. Fresh state: "Free plan", license input visible, upgrade button HIDDEN (CHECKOUT_URL empty).
2. Garbage key → "That key was not accepted…" inline; nothing stored (`chrome.storage.local.get("license")` in the options console → undefined/null).
3. With Bayu's LS test-mode product ready: fill `proConfig.ts` (test checkout URL + price string), rebuild → upgrade button appears; complete a TEST purchase; paste the emailed test key → status flips to "Pro active — <variant>"; entry hides; deactivate shows.
4. "Deactivate on this device" → back to Free plan (and the seat is freed in the LS dashboard).
5. If LS onboarding isn't done yet, defer step 3–4 to the release checklist run (Task 14 gates on it) — steps 1–2 must pass now.

- [ ] **Step 6: Commit**

```
git add src/lib/proConfig.ts src/options public/_locales
git commit -m "feat: Pro upgrade section with license activation in options"
```

---

### Task 12: Wire entitlements to the license + weekly revalidation

**Files:**
- Modify: `src/lib/entitlements.ts`
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `getLicense`, `isPro`, `revalidateLicense`, `applyValidation`, `saveLicense` from `license.ts`; `LICENSE_ALARM` constant already reserved in the worker (Task 2).
- Produces: `isProActive()` now reflects the real license everywhere it's already called (reminder cap in the picker, fill-form gate) with zero call-site changes.

- [ ] **Step 1: Real entitlements**

Replace the body of `src/lib/entitlements.ts`:

```ts
/**
 * The single gate every Pro check goes through: reminder cap, fill-in
 * form, template cap. Reads the stored license through the pure state
 * machine (14-day offline grace included).
 */
import { getLicense, isPro } from "./license";

export async function isProActive(now = Date.now()): Promise<boolean> {
  return isPro(await getLicense(), now);
}
```

- [ ] **Step 2: Weekly revalidation in the worker**

In `src/background/index.ts`:

Imports:
```ts
import { DAY_MS } from "../lib/types";
import { applyValidation, getLicense, revalidateLicense, saveLicense } from "../lib/license";
```

New function:
```ts
/**
 * Daily alarm, weekly work: validate only when the last success is ≥7 days
 * old, so the cadence survives browser restarts without extra bookkeeping.
 * Outcomes: valid refreshes the grace window; invalid soft-locks Pro (data
 * untouched, reminders still fire); unreachable lets the grace window run.
 */
async function revalidateIfDue(): Promise<void> {
  const state = await getLicense();
  if (!state || state.status === "invalid") return;
  if (Date.now() - state.lastValidatedAt < 7 * DAY_MS) return;
  const outcome = await revalidateLicense(state);
  await saveLicense(applyValidation(state, outcome, Date.now()));
}
```

In `sweepAndSchedule()`, add at the end:
```ts
  chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: 24 * 60 });
  await revalidateIfDue();
```

In `onAlarm`, replace the LICENSE_ALARM early-return with:
```ts
  if (alarm.name === LICENSE_ALARM) {
    await revalidateIfDue();
    return;
  }
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run build`. Reload.
1. Free profile (no license): third reminder still blocked; `{tracking}` still inserts literally. Nothing changed.
2. Activate the LS test key (or, if LS onboarding is pending, temporarily seed a state from the worker console — do not commit anything for this):
   ```js
   chrome.storage.local.set({ license: { key: "TEST", instanceId: "T", plan: "Pro", status: "invalid", lastValidatedAt: Date.now() } })
   ```
   With a real active test license: third reminder allowed; fill-in form appears. With the seeded `status: "invalid"`: both Pro features off, existing reminders still fire (set one while Pro, invalidate, wait — it fires).
3. Worker console: `chrome.alarms.getAll(console.log)` shows `qr-license-revalidate` with a ~daily period.
4. Remove any seeded state: `chrome.storage.local.remove("license")`.

- [ ] **Step 4: Commit**

```
git add src/lib/entitlements.ts src/background/index.ts
git commit -m "feat: entitlements read the real license; weekly revalidation in background"
```

---

### Task 13: Enforce the free template cap

**Files:**
- Modify: `src/lib/importExport.ts`
- Modify: `src/options/options.ts`
- Modify: `public/_locales/en/messages.json`, `public/_locales/id/messages.json`
- Test: `tests/importExport.test.ts`

**Interfaces:**
- Consumes: `FREE_TEMPLATE_CAP` (types), `isProActive` (entitlements), `#pro` section anchor (Task 11).
- Produces: `capImport(existingCount: number, incoming: Template[], pro: boolean): { accepted: Template[]; skipped: number }` in `importExport.ts`.
- **Semantics (from the spec — do not deviate):** the cap blocks NEW adds and imports only. Editing, using, exporting, and deleting existing templates is NEVER affected, including for a v1 user who updates with >15 templates.

- [ ] **Step 1: Write the failing tests**

Append to `tests/importExport.test.ts` (import `capImport` alongside the existing imports; build templates with the file's existing helper if one exists, otherwise inline literals matching the `Template` type):

```ts
import { capImport } from "../src/lib/importExport";
import type { Template } from "../src/lib/types";

function tpl(id: string): Template {
  return { id, title: id, shortcut: "", body: "x", createdAt: 1, usageCount: 0 };
}

describe("capImport", () => {
  const incoming = [tpl("a"), tpl("b"), tpl("c")];

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
```

Run: `npx vitest run tests/importExport.test.ts` — Expected: FAIL (no export `capImport`).

- [ ] **Step 2: Implement `capImport`**

In `src/lib/importExport.ts` (add `FREE_TEMPLATE_CAP` to the types import):

```ts
/** Free-tier import semantics: fill remaining slots in order, skip the rest.
 *  Never touches existing templates. */
export function capImport(
  existingCount: number,
  incoming: Template[],
  pro: boolean
): { accepted: Template[]; skipped: number } {
  if (pro) return { accepted: incoming, skipped: 0 };
  const room = Math.max(0, FREE_TEMPLATE_CAP - existingCount);
  return { accepted: incoming.slice(0, room), skipped: Math.max(0, incoming.length - room) };
}
```

Run: `npx vitest run tests/importExport.test.ts` — Expected: PASS.

- [ ] **Step 3: i18n keys (both locales)**

en:
```json
"templateCountCapped": { "message": "$COUNT$ / $CAP$ templates", "placeholders": { "COUNT": { "content": "$1" }, "CAP": { "content": "$2" } } },
"proRemovesLimit": { "message": "Pro removes the limit" },
"templateCapReached": { "message": "You have 15 templates — the free limit. Everything you have keeps working; Pro removes the limit." },
"importCapped": { "message": "Imported $N$ templates; $M$ skipped (free limit of 15)." }
```
id:
```json
"templateCountCapped": { "message": "$COUNT$ / $CAP$ template", "placeholders": { "COUNT": { "content": "$1" }, "CAP": { "content": "$2" } } },
"proRemovesLimit": { "message": "Pro menghapus batas" },
"templateCapReached": { "message": "Anda punya 15 template — batas versi gratis. Semua tetap berfungsi; Pro menghapus batasnya." },
"importCapped": { "message": "$N$ template diimpor; $M$ dilewati (batas gratis 15)." }
```

- [ ] **Step 4: Enforce in `options.ts`**

Imports: `FREE_TEMPLATE_CAP` from `../lib/types`, `capImport` from `../lib/importExport`, `isProActive` from `../lib/entitlements`.

1. Counter — in `render()`, replace the `count.textContent = ...` line with:
```ts
  const pro = await isProActive();
  if (pro) {
    count.textContent = t("templateCount", [String(templates.length)]);
  } else {
    count.textContent =
      t("templateCountCapped", [String(templates.length), String(FREE_TEMPLATE_CAP)]) + " · ";
    const a = document.createElement("a");
    a.href = "#pro";
    a.textContent = t("proRemovesLimit");
    count.appendChild(a);
  }
```
(Assigning `textContent` first wipes any previous children, so re-renders stay clean.)

2. Add gate — the Add button and the save path (defense in depth; the save path also catches an editor opened before the cap was hit):
```ts
$("#add").addEventListener("click", async () => {
  if (!(await isProActive()) && (await getTemplates()).length >= FREE_TEMPLATE_CAP) {
    status.textContent = t("templateCapReached");
    return;
  }
  openEditor(null);
});
```
In the `#save` handler, before `saveTemplate`, when `editingId === null` (a NEW template):
```ts
  if (editingId === null && !(await isProActive()) && (await getTemplates()).length >= FREE_TEMPLATE_CAP) {
    status.textContent = t("templateCapReached");
    return;
  }
```
Edits of existing templates (`editingId !== null`) are NEVER blocked — including for users already over the cap.

3. Import — replace the plain save loop:
```ts
  const { accepted, skipped } = capImport(
    (await getTemplates()).length,
    result.templates,
    await isProActive()
  );
  try {
    for (const tpl of accepted) await saveTemplate(tpl);
  } catch (err) {
    status.textContent = String(err);
    return;
  }
  status.textContent =
    skipped > 0
      ? t("importCapped", [String(accepted.length), String(skipped)])
      : t("importSuccess");
  await render();
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`. Reload, options page, NO license:
1. Counter reads "N / 15 templates · Pro removes the limit"; the link jumps to the Pro section.
2. At 15 templates: Add shows the cap message; import of 3 more reports "Imported 0 templates; 3 skipped…".
3. At 13: importing 3 accepts 2, skips 1.
4. **Grandfather test (spec success criterion):** seed 18 templates (import a 18-template JSON while TEMPORARILY Pro via the Task 12 console seed, then remove the license): all 18 render, all remain editable/insertable/deletable, counter shows "18 / 15", Add is blocked. Remove the seeded license afterwards.
5. With an active test license: plain "N templates" counter, Add works past 15, imports unlimited.

- [ ] **Step 6: Commit**

```
git add src/lib/importExport.ts src/options/options.ts tests/importExport.test.ts public/_locales
git commit -m "feat: enforce free template cap - blocks new adds and imports only"
```

---

### Task 14: Release 1.1.0 — docs, store copy, checklist, zip

**Files:**
- Modify: `public/manifest.json`, `package.json` (version → `1.1.0`)
- Modify: `docs/privacy-policy.md`, `docs/store-listing.md`, `docs/release-checklist.md`
- Build: `quickreply.zip`

**Interfaces:** none — documentation and packaging. ⚠️ Final store submission is Bayu's manual action, gated on the full checklist run (which needs live WhatsApp + an LS test purchase).

- [ ] **Step 1: Version bump**

`public/manifest.json` `"version": "1.1.0"`; `package.json` `"version": "1.1.0"`.

- [ ] **Step 2: Privacy policy licensing paragraph**

Read `docs/privacy-policy.md` first and match its voice/structure. Add a "License validation (Pro)" section stating exactly: if — and only if — you purchase Pro and enter a license key, the extension sends that license key (and the activation instance id) to our payment provider, Lemon Squeezy, to activate it and to re-check it roughly weekly; this is the only network request the extension ever makes; no message content, contact data, template text, or usage data is ever transmitted; users who never enter a license key send nothing at all. Update the effective date to 2026-07-XX (the actual date this task runs). Keep the em-dash-free style (Bayu's preference: no em-dashes in outward-facing copy — use commas/parentheses; this applies to store listing text too).

- [ ] **Step 3: Store listing + questionnaire notes**

Read `docs/store-listing.md` first. Add (en and id, matching existing structure, no em-dashes):
1. A "Pro" paragraph: follow-up reminders (2 free), unlimited templates, fill-in form for placeholders; one-line "never sends messages for you" reassurance retained.
2. Permission justifications section for the resubmission form: `alarms` (schedule the follow-up reminders you set), `notifications` (show the reminder when it is due), existing host permission unchanged.
3. Data questionnaire delta: "authentication information" is now collected (the license key, sent only to the payment provider for activation/validation); all certifications remain true.
4. Version line 1.1.0.

- [ ] **Step 4: Extend the release checklist**

Read `docs/release-checklist.md` first; append new sections in its existing format:
- **Reminders e2e:** set via each preset + custom; fires while browsing; missed-while-closed fires on startup; badge counts and clears; notification click focuses the tab AND opens the right chat; click with WhatsApp closed opens a tab and navigates; chat missing from sidebar → focus-only fallback, no errors.
- **Purchase flow (LS test mode):** checkout opens from options; test purchase delivers a key; activation flips Pro; deactivate returns to free; refund the test purchase in the LS dashboard → after revalidation Pro soft-locks with all data intact and existing reminders firing (spec success criterion).
- **Cap:** counter states, add-block at 15, partial import report, grandfathered >15 user keeps everything working.
- **Fill-in form (Pro):** mixed template → form; auto values greyed/overridable; Tab/Enter/Esc; free tier unchanged.
- **Free polish:** multi-select delete; theme matching across the 4 OS×WhatsApp combos; new icon renders in toolbar, extensions page, notifications.
- **Migration:** load the v1.0.0 zip's data (or a profile that used v1), update in place → templates intact, schemaVersion 2, nothing lost.
- **Both browsers:** the full pass on Chrome, the happy path on Edge.

- [ ] **Step 5: Full verification + zip**

Run: `npm test && npm run typecheck && npm run zip`
Expected: all tests pass, clean typecheck, `quickreply.zip` written. Verify the archive: `tar -tf quickreply.zip` must list `manifest.json`, `content.js`, `background.js`, `assets/`, `icons/`, `_locales/`, `src/` entries — all WITHOUT a `./` prefix (v1 lesson: `./`-prefixed entries broke Explorer and risk store rejection). Load the zip's extracted contents as an unpacked extension once as a smoke test.

- [ ] **Step 6: Commit**

```
git add public/manifest.json package.json docs/privacy-policy.md docs/store-listing.md docs/release-checklist.md
git commit -m "chore: release 1.1.0 - version bump, privacy policy licensing section, store copy, checklist"
```

Then: Bayu runs the full checklist on live WhatsApp Web (both browsers), does the LS test purchase + refund pass, and only after every box is ticked submits `quickreply.zip` to the Chrome Web Store (updating the data questionnaire per Step 3). Note: v1.0.0 may still be in review — if so, coordinate: either wait for v1 approval or replace the pending submission per the dashboard's options.

---

## Post-plan notes for the executor

- **Branch:** create `feature/quickreply-v1.1` off `master` before Task 1 (use superpowers:using-git-worktrees at execution time).
- **External dependency:** Lemon Squeezy onboarding (Task 11's human step) can lag behind the code. Tasks 11–13 are verifiable with console-seeded license states; the LS test purchase is a hard gate only for Task 14's checklist, not for merging code tasks.
- **Two review checkpoints need Bayu personally:** the icon (Task 9) and the end-to-end purchase flow (Task 14). Everything else a subagent + code review can verify.
- **If WhatsApp's DOM disagrees** with `sidebarChatTitle` or the theme class during any manual step: fix ONLY `whatsappAdapter.ts`, update its comments with what was observed, and note it in the task's commit message.
