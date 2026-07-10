# QuickReply for WhatsApp Web — v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of a Manifest V3 Chrome/Edge extension that lets WhatsApp Web users insert reusable message templates (with `{name}` auto-filled from the open chat) via a keyboard-driven picker, with an options page for template CRUD and JSON import/export.

**Architecture:** Three parts: (1) pure-logic library modules (template engine, search ranking, storage wrapper, import/export) — fully unit-tested with Vitest; (2) an options page (plain DOM + TypeScript) for managing templates; (3) a content script for web.whatsapp.com containing a picker overlay and a quarantined WhatsApp DOM adapter (the only file that knows WhatsApp's HTML). All data in `chrome.storage.local`; no servers, no accounts, no telemetry, no background worker.

**Tech Stack:** TypeScript (strict), Vite (two configs: options page as HTML entry, content script as IIFE lib build), Vitest, `@types/chrome`. No UI framework. Node 20+.

## Global Constraints

- Manifest V3; permissions: `storage` only; host access limited to `https://web.whatsapp.com/*`.
- **Never auto-send.** The extension only inserts text into the compose box; the user presses send. No code may dispatch send actions.
- No network requests of any kind. No analytics. No remote code.
- All WhatsApp DOM knowledge (selectors, insertion mechanics) lives ONLY in `src/content/whatsappAdapter.ts`.
- UI strings in English and Indonesian via Chrome i18n (`_locales/en`, `_locales/id`); `default_locale: "en"`.
- Free-tier template cap is **15**, defined as a constant, **not enforced in v1** (counter displayed only).
- TDD for all `src/lib/*` modules: write the failing test first, watch it fail, implement, watch it pass, commit.
- Commit after every task (and at every commit step inside tasks). Conventional commit messages (`feat:`, `test:`, `chore:`, `docs:`).

## File Structure

```
public/manifest.json              — MV3 manifest (copied verbatim to dist/)
public/_locales/en/messages.json  — English strings
public/_locales/id/messages.json  — Indonesian strings
public/icons/                     — icon16/48/128.png (created in Task 9)
src/lib/types.ts                  — Template, Settings, constants
src/lib/template.ts               — placeholder parsing/filling (pure)
src/lib/search.ts                 — picker search ranking (pure)
src/lib/storage.ts                — typed wrapper over chrome.storage.local
src/lib/importExport.ts           — JSON export/import validation (pure)
src/options/options.html          — options page markup
src/options/options.css           — options page styles
src/options/options.ts            — options page logic (CRUD, import/export)
src/content/whatsappAdapter.ts    — QUARANTINE: all WhatsApp DOM code
src/content/picker.ts             — picker overlay UI component
src/content/index.ts              — content entry: hotkeys, wiring, notices
tests/template.test.ts
tests/search.test.ts
tests/storage.test.ts
tests/importExport.test.ts
vite.config.ts                    — builds options page → dist/
vite.content.config.ts            — builds content script (IIFE) → dist/content.js
package.json / tsconfig.json / .gitignore
docs/release-checklist.md         — manual test script (Task 9)
docs/privacy-policy.md            — store listing requirement (Task 9)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vite.content.config.ts`, `.gitignore`, `public/manifest.json`, `public/_locales/en/messages.json`, `public/_locales/id/messages.json`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `npm test` runs Vitest and `npm run build` produces a loadable `dist/` (content script + options page + manifest).

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.zip
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "quickreply-whatsapp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "vite build && vite build --config vite.content.config.ts"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.280",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["chrome"],
    "skipLibCheck": true
  },
  "include": ["src", "tests", "vite.config.ts", "vite.content.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`** (options page build)

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { options: "src/options/options.html" },
    },
  },
});
```

- [ ] **Step 5: Create `vite.content.config.ts`** (content script build — must be a single IIFE file because MV3 content scripts are not ES modules)

```ts
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "QuickReply",
      fileName: () => "content.js",
    },
  },
});
```

- [ ] **Step 6: Create `public/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "__MSG_appName__",
  "description": "__MSG_appDesc__",
  "version": "0.1.0",
  "default_locale": "en",
  "options_page": "src/options/options.html",
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": ["https://web.whatsapp.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 7: Create `public/_locales/en/messages.json`**

```json
{
  "appName": { "message": "QuickReply for WhatsApp Web" },
  "appDesc": { "message": "Answer customers in two keystrokes: reusable message templates with auto-filled variables inside WhatsApp Web." },
  "optionsTitle": { "message": "Your templates" },
  "templateCount": { "message": "$COUNT$ templates", "placeholders": { "COUNT": { "content": "$1" } } },
  "addTemplate": { "message": "Add template" },
  "fieldTitle": { "message": "Title" },
  "fieldShortcut": { "message": "Shortcut" },
  "fieldBody": { "message": "Message" },
  "placeholderHint": { "message": "Tip: use {name} and it will be filled with the customer's name automatically. You can invent other placeholders like {date} and fill them while typing." },
  "save": { "message": "Save" },
  "cancel": { "message": "Cancel" },
  "edit": { "message": "Edit" },
  "delete": { "message": "Delete" },
  "export": { "message": "Export templates" },
  "import": { "message": "Import templates" },
  "importSuccess": { "message": "Templates imported." },
  "importError": { "message": "That file is not a valid QuickReply export. Nothing was changed." },
  "validationError": { "message": "Title and message are required." },
  "pickerPlaceholder": { "message": "Search templates…" },
  "noResults": { "message": "No matching templates" },
  "noTemplatesYet": { "message": "No templates yet — add your first one in the extension options." },
  "openChatFirst": { "message": "Open a chat first — or WhatsApp Web may have changed and an update is coming." }
}
```

- [ ] **Step 8: Create `public/_locales/id/messages.json`**

```json
{
  "appName": { "message": "QuickReply untuk WhatsApp Web" },
  "appDesc": { "message": "Balas pelanggan dengan dua tombol: template pesan siap pakai dengan variabel otomatis di WhatsApp Web." },
  "optionsTitle": { "message": "Template Anda" },
  "templateCount": { "message": "$COUNT$ template", "placeholders": { "COUNT": { "content": "$1" } } },
  "addTemplate": { "message": "Tambah template" },
  "fieldTitle": { "message": "Judul" },
  "fieldShortcut": { "message": "Pintasan" },
  "fieldBody": { "message": "Pesan" },
  "placeholderHint": { "message": "Tips: gunakan {name} dan nama pelanggan akan terisi otomatis. Anda juga bisa membuat placeholder lain seperti {tanggal} dan mengisinya saat mengetik." },
  "save": { "message": "Simpan" },
  "cancel": { "message": "Batal" },
  "edit": { "message": "Ubah" },
  "delete": { "message": "Hapus" },
  "export": { "message": "Ekspor template" },
  "import": { "message": "Impor template" },
  "importSuccess": { "message": "Template berhasil diimpor." },
  "importError": { "message": "File tersebut bukan ekspor QuickReply yang valid. Tidak ada yang diubah." },
  "validationError": { "message": "Judul dan pesan wajib diisi." },
  "pickerPlaceholder": { "message": "Cari template…" },
  "noResults": { "message": "Tidak ada template yang cocok" },
  "noTemplatesYet": { "message": "Belum ada template — tambahkan lewat opsi ekstensi." },
  "openChatFirst": { "message": "Buka chat dulu — atau WhatsApp Web berubah dan pembaruan sedang disiapkan." }
}
```

- [ ] **Step 9: Create `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: Install and verify**

Run: `npm install`
Run: `npm test`
Expected: 1 passed (smoke.test.ts).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold MV3 extension with Vite, Vitest, i18n (en/id)"
```

---

### Task 2: Types + template engine

**Files:**
- Create: `src/lib/types.ts`, `src/lib/template.ts`
- Test: `tests/template.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Template { id: string; title: string; shortcut: string; body: string; createdAt: number; usageCount: number }`
  - `Settings { hotkey: string; language: "en" | "id" | "auto" }`
  - `SCHEMA_VERSION = 1`, `FREE_TEMPLATE_CAP = 15`, `DEFAULT_SETTINGS`
  - `extractPlaceholders(body: string): string[]`
  - `fillTemplate(body: string, vars: Record<string, string>): string`

- [ ] **Step 1: Create `src/lib/types.ts`** (types only — no test needed)

```ts
export interface Template {
  id: string;
  title: string;
  shortcut: string;
  body: string;
  createdAt: number;
  usageCount: number;
}

export interface Settings {
  hotkey: string;
  language: "en" | "id" | "auto";
}

export const SCHEMA_VERSION = 1;

/** Free-tier cap. Displayed as a counter in v1; NOT enforced until Pro exists (see spec, Monetization). */
export const FREE_TEMPLATE_CAP = 15;

export const DEFAULT_SETTINGS: Settings = { hotkey: "Ctrl+/", language: "auto" };
```

- [ ] **Step 2: Write the failing tests — `tests/template.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/template.test.ts`
Expected: FAIL — cannot resolve `../src/lib/template`.

- [ ] **Step 4: Implement `src/lib/template.ts`**

```ts
const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = vars[key];
    return value ? value : whole;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/template.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/template.ts tests/template.test.ts
git commit -m "feat: template engine - placeholder extraction and filling"
```

---

### Task 3: Search ranking

**Files:**
- Create: `src/lib/search.ts`
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `Template` from `src/lib/types.ts`.
- Produces: `rankTemplates(templates: Template[], query: string): Template[]` — empty/whitespace query returns all sorted by `usageCount` desc then `title` asc; otherwise scores each template (shortcut exact=4, shortcut prefix=3, title prefix=2, substring in title or shortcut=1, else excluded), sorts by score desc, then `usageCount` desc, then `title` asc. Matching is case-insensitive.

- [ ] **Step 1: Write the failing tests — `tests/search.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — cannot resolve `../src/lib/search`.

- [ ] **Step 3: Implement `src/lib/search.ts`**

```ts
import type { Template } from "./types";

function score(t: Template, query: string): number {
  const shortcut = t.shortcut.toLowerCase();
  const title = t.title.toLowerCase();
  if (shortcut !== "" && shortcut === query) return 4;
  if (shortcut !== "" && shortcut.startsWith(query)) return 3;
  if (title.startsWith(query)) return 2;
  if (title.includes(query) || (shortcut !== "" && shortcut.includes(query))) return 1;
  return 0;
}

function byUsageThenTitle(a: Template, b: Template): number {
  return b.usageCount - a.usageCount || a.title.localeCompare(b.title);
}

export function rankTemplates(templates: Template[], query: string): Template[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...templates].sort(byUsageThenTitle);
  return templates
    .map((t) => ({ t, s: score(t, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || byUsageThenTitle(a.t, b.t))
    .map((x) => x.t);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/search.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/search.ts tests/search.test.ts
git commit -m "feat: picker search ranking (shortcut > title > substring, usage tiebreak)"
```

---

### Task 4: Storage layer

**Files:**
- Create: `src/lib/storage.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: `Template`, `Settings`, `DEFAULT_SETTINGS`, `SCHEMA_VERSION` from `src/lib/types.ts`.
- Produces (all async, all talk only to `chrome.storage.local`):
  - `getTemplates(): Promise<Template[]>`
  - `saveTemplate(t: Template): Promise<void>` — upsert by `id`
  - `deleteTemplate(id: string): Promise<void>`
  - `incrementUsage(id: string): Promise<void>`
  - `getSettings(): Promise<Settings>`
  - `saveSettings(s: Settings): Promise<void>`
- Storage shape: keys `schemaVersion` (number), `templates` (Template[]), `settings` (Settings).

- [ ] **Step 1: Write the failing tests — `tests/storage.test.ts`** (in-memory chrome mock; the mock mirrors the promise-based `chrome.storage.local.get(key)/set(obj)` API)

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL — cannot resolve `../src/lib/storage`.

- [ ] **Step 3: Implement `src/lib/storage.ts`**

```ts
import type { Template, Settings } from "./types";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./types";

async function read<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  const value = result[key] as T | undefined;
  return value === undefined ? fallback : value;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value, schemaVersion: SCHEMA_VERSION });
}

export async function getTemplates(): Promise<Template[]> {
  return read<Template[]>("templates", []);
}

async function setTemplates(templates: Template[]): Promise<void> {
  await write("templates", templates);
}

export async function saveTemplate(t: Template): Promise<void> {
  const all = await getTemplates();
  const i = all.findIndex((x) => x.id === t.id);
  if (i === -1) all.push(t);
  else all[i] = t;
  await setTemplates(all);
}

export async function deleteTemplate(id: string): Promise<void> {
  await setTemplates((await getTemplates()).filter((t) => t.id !== id));
}

export async function incrementUsage(id: string): Promise<void> {
  const all = await getTemplates();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  t.usageCount += 1;
  await setTemplates(all);
}

export async function getSettings(): Promise<Settings> {
  return read<Settings>("settings", DEFAULT_SETTINGS);
}

export async function saveSettings(s: Settings): Promise<void> {
  await write("settings", s);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts tests/storage.test.ts
git commit -m "feat: typed chrome.storage.local wrapper with schema version"
```

---

### Task 5: Import/export

**Files:**
- Create: `src/lib/importExport.ts`
- Test: `tests/importExport.test.ts`

**Interfaces:**
- Consumes: `Template`, `SCHEMA_VERSION` from `src/lib/types.ts`.
- Produces:
  - `exportToJson(templates: Template[]): string` — pretty JSON `{ schemaVersion, templates }`
  - `type ImportResult = { ok: true; templates: Template[] } | { ok: false; error: "invalid-json" | "invalid-format" | "invalid-template" }`
  - `parseImport(json: string): ImportResult` — validates before anything is written; imported templates get fresh `id` (crypto.randomUUID) and fresh `createdAt`; `usageCount` preserved when it is a number, else 0. **Import appends; it never deletes existing templates.**

- [ ] **Step 1: Write the failing tests — `tests/importExport.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { Template } from "../src/lib/types";
import { exportToJson, parseImport } from "../src/lib/importExport";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/importExport.test.ts`
Expected: FAIL — cannot resolve `../src/lib/importExport`.

- [ ] **Step 3: Implement `src/lib/importExport.ts`**

```ts
import type { Template } from "./types";
import { SCHEMA_VERSION } from "./types";

export type ImportResult =
  | { ok: true; templates: Template[] }
  | { ok: false; error: "invalid-json" | "invalid-format" | "invalid-template" };

export function exportToJson(templates: Template[]): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, templates }, null, 2);
}

export function parseImport(json: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "invalid-format" };
  const raw = (data as { templates?: unknown }).templates;
  if (!Array.isArray(raw)) return { ok: false, error: "invalid-format" };

  const templates: Template[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "invalid-template" };
    const r = item as Record<string, unknown>;
    if (
      typeof r.title !== "string" ||
      typeof r.shortcut !== "string" ||
      typeof r.body !== "string"
    ) {
      return { ok: false, error: "invalid-template" };
    }
    templates.push({
      id: crypto.randomUUID(),
      title: r.title,
      shortcut: r.shortcut,
      body: r.body,
      createdAt: Date.now(),
      usageCount: typeof r.usageCount === "number" ? r.usageCount : 0,
    });
  }
  return { ok: true, templates };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/importExport.test.ts`
Expected: PASS (5 tests). Also run the full suite: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/importExport.ts tests/importExport.test.ts
git commit -m "feat: JSON export and validated append-only import"
```

---

### Task 6: Options page

**Files:**
- Create: `src/options/options.html`, `src/options/options.css`, `src/options/options.ts`

**Interfaces:**
- Consumes: `getTemplates`, `saveTemplate`, `deleteTemplate` from `src/lib/storage.ts`; `exportToJson`, `parseImport` from `src/lib/importExport.ts`; `FREE_TEMPLATE_CAP`, `Template` from `src/lib/types.ts`.
- Produces: a working options page in `dist/src/options/options.html` (template CRUD, counter, export/import). No new programmatic interfaces.

- [ ] **Step 1: Create `src/options/options.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>QuickReply</title>
    <link rel="stylesheet" href="./options.css" />
  </head>
  <body>
    <main>
      <h1 data-i18n="optionsTitle"></h1>
      <p id="count" class="muted"></p>

      <ul id="list"></ul>
      <p id="empty" class="muted" data-i18n="noTemplatesYet" hidden></p>

      <button id="add" class="primary" data-i18n="addTemplate"></button>

      <section id="editor" hidden>
        <label><span data-i18n="fieldTitle"></span><input id="f-title" maxlength="60" /></label>
        <label><span data-i18n="fieldShortcut"></span><input id="f-shortcut" maxlength="20" /></label>
        <label><span data-i18n="fieldBody"></span><textarea id="f-body" rows="5"></textarea></label>
        <p class="muted" data-i18n="placeholderHint"></p>
        <div class="row">
          <button id="save" class="primary" data-i18n="save"></button>
          <button id="cancel" data-i18n="cancel"></button>
        </div>
      </section>

      <hr />
      <div class="row">
        <button id="export" data-i18n="export"></button>
        <button id="import" data-i18n="import"></button>
        <input type="file" id="import-file" accept=".json,application/json" hidden />
      </div>
      <p id="status" class="muted" role="status"></p>
    </main>
    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/options/options.css`**

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; background: #f0f2f5; color: #111b21; }
main { max-width: 640px; margin: 2rem auto; padding: 1.5rem; background: #fff; border-radius: 12px; }
h1 { font-size: 1.3rem; margin-top: 0; }
.muted { color: #667781; font-size: 0.85rem; }
ul { list-style: none; padding: 0; }
li { display: flex; align-items: baseline; gap: 0.6rem; padding: 0.5rem 0; border-bottom: 1px solid #e9edef; }
li .t-title { font-weight: 600; }
li .t-shortcut { font-family: monospace; color: #008069; }
li .t-body { flex: 1; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { border: 1px solid #d1d7db; background: #fff; border-radius: 8px; padding: 0.45rem 0.9rem; cursor: pointer; font-size: 0.9rem; }
button.primary { background: #008069; border-color: #008069; color: #fff; }
button.small { padding: 0.2rem 0.5rem; font-size: 0.8rem; }
label { display: block; margin: 0.7rem 0; }
label span { display: block; font-size: 0.85rem; margin-bottom: 0.2rem; }
input, textarea { width: 100%; padding: 0.5rem; border: 1px solid #d1d7db; border-radius: 8px; font: inherit; }
.row { display: flex; gap: 0.6rem; margin-top: 0.6rem; }
#editor { background: #f7f8fa; border-radius: 8px; padding: 0.8rem 1rem; margin-top: 1rem; }
```

- [ ] **Step 3: Create `src/options/options.ts`**

```ts
import type { Template } from "../lib/types";
import { FREE_TEMPLATE_CAP } from "../lib/types";
import { getTemplates, saveTemplate, deleteTemplate } from "../lib/storage";
import { exportToJson, parseImport } from "../lib/importExport";

const t = (key: string, subs?: string[]): string =>
  chrome.i18n.getMessage(key, subs) || key;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

// Apply translations to all data-i18n elements.
for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n as string);
}

const list = $<HTMLUListElement>("#list");
const empty = $("#empty");
const count = $("#count");
const editor = $("#editor");
const fTitle = $<HTMLInputElement>("#f-title");
const fShortcut = $<HTMLInputElement>("#f-shortcut");
const fBody = $<HTMLTextAreaElement>("#f-body");
const status = $("#status");

let editingId: string | null = null;

async function render(): Promise<void> {
  const templates = await getTemplates();
  count.textContent = `${t("templateCount", [String(templates.length)])} · ${templates.length}/${FREE_TEMPLATE_CAP}`;
  empty.hidden = templates.length > 0;
  list.replaceChildren(
    ...templates.map((tpl) => {
      const li = document.createElement("li");
      const title = document.createElement("span");
      title.className = "t-title";
      title.textContent = tpl.title;
      const shortcut = document.createElement("span");
      shortcut.className = "t-shortcut";
      shortcut.textContent = tpl.shortcut ? `/${tpl.shortcut}` : "";
      const body = document.createElement("span");
      body.className = "t-body";
      body.textContent = tpl.body;
      const edit = document.createElement("button");
      edit.className = "small";
      edit.textContent = t("edit");
      edit.addEventListener("click", () => openEditor(tpl));
      const del = document.createElement("button");
      del.className = "small";
      del.textContent = t("delete");
      del.addEventListener("click", async () => {
        await deleteTemplate(tpl.id);
        await render();
      });
      li.append(title, shortcut, body, edit, del);
      return li;
    })
  );
}

function openEditor(tpl: Template | null): void {
  editingId = tpl?.id ?? null;
  fTitle.value = tpl?.title ?? "";
  fShortcut.value = tpl?.shortcut ?? "";
  fBody.value = tpl?.body ?? "";
  editor.hidden = false;
  fTitle.focus();
}

function closeEditor(): void {
  editor.hidden = true;
  editingId = null;
}

$("#add").addEventListener("click", () => openEditor(null));
$("#cancel").addEventListener("click", closeEditor);

$("#save").addEventListener("click", async () => {
  const title = fTitle.value.trim();
  const body = fBody.value;
  if (!title || !body.trim()) {
    status.textContent = t("validationError");
    return;
  }
  try {
    const existing = editingId ? (await getTemplates()).find((x) => x.id === editingId) : null;
    await saveTemplate({
      id: editingId ?? crypto.randomUUID(),
      title,
      shortcut: fShortcut.value.trim().replace(/^\//, "").toLowerCase(),
      body,
      createdAt: existing?.createdAt ?? Date.now(),
      usageCount: existing?.usageCount ?? 0,
    });
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  status.textContent = "";
  closeEditor();
  await render();
});

$("#export").addEventListener("click", async () => {
  const blob = new Blob([exportToJson(await getTemplates())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "quickreply-templates.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

const importFile = $<HTMLInputElement>("#import-file");
$("#import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  const result = parseImport(await file.text());
  if (!result.ok) {
    status.textContent = t("importError");
    return;
  }
  for (const tpl of result.templates) await saveTemplate(tpl);
  status.textContent = t("importSuccess");
  await render();
});

void render();
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: `dist/` contains `manifest.json`, `content.js` *(may fail until Task 8 — if `src/content/index.ts` doesn't exist yet, create it now as a stub:)*

```ts
// src/content/index.ts — stub, replaced in Task 8
export {};
```

then rerun `npm run build`. Expected: `dist/manifest.json`, `dist/content.js`, `dist/src/options/options.html`, `dist/_locales/...` all present.

- [ ] **Step 5: Manual test — load unpacked**

1. Open `chrome://extensions`, enable Developer mode, "Load unpacked" → select the `dist/` folder.
2. Click the extension's "Options" (Details → Extension options).
3. Verify: add 2 templates (one with `{name}` in the body), edit one, delete one, counter shows `n/15`, export downloads a JSON file, re-import that file appends and shows the success message, importing a garbage `.txt`-renamed-`.json` shows the error message and changes nothing.
4. Switch Chrome language to Indonesian (or launch `chrome.exe --lang=id`) and confirm the UI is translated.

- [ ] **Step 6: Commit**

```bash
git add src/options src/content/index.ts
git commit -m "feat: options page with template CRUD, counter, import/export (en/id)"
```

---

### Task 7: WhatsApp DOM adapter (QUARANTINE module)

**Files:**
- Create: `src/content/whatsappAdapter.ts`

**Interfaces:**
- Consumes: nothing from our code (by design — this file talks only to WhatsApp's DOM).
- Produces:
  - `isWhatsAppLoaded(): boolean` — WhatsApp app shell is present
  - `getComposeBox(): HTMLElement | null` — the message input of the open chat, or null
  - `getChatName(): string | null` — display name of the open chat, or null
  - `insertText(text: string): boolean` — inserts at the caret in the compose box; returns success. **Never sends.**

**Note to implementer:** WhatsApp ships UI changes without notice; the selectors below are the best known starting point and MUST be verified against live web.whatsapp.com during this task (open DevTools, inspect the compose box and chat header). If they differ, update the constants — that is this module's entire purpose. Everything else in the codebase must keep compiling unchanged.

- [ ] **Step 1: Implement `src/content/whatsappAdapter.ts`**

```ts
/**
 * QUARANTINE MODULE — the only file allowed to know WhatsApp's DOM.
 * When WhatsApp Web changes its HTML, fix the SELECTORS below and nothing else.
 * HARD RULE: this module never triggers message sending.
 */
const SELECTORS = {
  appRoot: "#app",
  // The compose box is a contenteditable div inside the footer of the open chat.
  composeBox: 'footer div[contenteditable="true"]',
  // The open chat's name: header inside #main, a span carrying a title attribute.
  chatHeader: "#main header span[title]",
};

export function isWhatsAppLoaded(): boolean {
  return document.querySelector(SELECTORS.appRoot) !== null;
}

export function getComposeBox(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.composeBox);
}

export function getChatName(): string | null {
  const el = document.querySelector<HTMLElement>(SELECTORS.chatHeader);
  const name = el?.getAttribute("title") ?? el?.textContent ?? "";
  return name.trim() === "" ? null : name.trim();
}

export function insertText(text: string): boolean {
  const box = getComposeBox();
  if (!box) return false;
  box.focus();
  // execCommand is deprecated but remains the only insertion path that
  // WhatsApp's editor reliably accepts as user input (fires input events,
  // updates its internal state). Guarded so a future removal degrades safely.
  try {
    const ok = document.execCommand("insertText", false, text);
    if (!ok) return false;
  } catch {
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Verify selectors against live WhatsApp Web**

1. Run `npm run build`, reload the unpacked extension, open https://web.whatsapp.com and log in.
2. Open DevTools console on the WhatsApp tab and check each selector:
   - `document.querySelector('footer div[contenteditable="true"]')` → the message input (click a chat first).
   - `document.querySelector('#main header span[title]')` → element whose `title` is the chat's display name.
3. If a selector returns null or the wrong element, inspect the live DOM and update the `SELECTORS` constant until correct. Record any changed selector in the commit message.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/content/whatsappAdapter.ts
git commit -m "feat: quarantined WhatsApp DOM adapter (compose box, chat name, insert)"
```

---

### Task 8: Picker overlay + content script wiring

**Files:**
- Create: `src/content/picker.ts`
- Modify: `src/content/index.ts` (replace the Task 6 stub entirely)

**Interfaces:**
- Consumes: `rankTemplates` (Task 3), `fillTemplate` (Task 2), `getTemplates`, `incrementUsage` (Task 4), all four adapter functions (Task 7), `Template` type.
- Produces: `class Picker { constructor(onSelect: (t: Template) => void); openAt(anchor: DOMRect): Promise<void>; close(): void; get isOpen(): boolean }` and the final `content.js` behavior:
  - `Ctrl+/` anywhere on the page toggles the picker (works even when the compose box isn't focused).
  - Typing `/` while the compose box is focused **and empty** opens the picker (the `/` is swallowed).
  - Picker: type to search, ↑/↓ to move, Enter to insert, Esc to close, click item to insert.
  - On insert: `{name}` filled from the open chat, unknown placeholders left visible, `usageCount` incremented. Text is inserted, never sent.
  - If no compose box is found on hotkey press, a 3-second toast shows the `openChatFirst` message.

- [ ] **Step 1: Create `src/content/picker.ts`**

```ts
import type { Template } from "../lib/types";
import { rankTemplates } from "../lib/search";
import { getTemplates } from "../lib/storage";

const t = (key: string): string => chrome.i18n.getMessage(key) || key;

const CSS = `
.qr-panel { position: fixed; z-index: 9999; width: 380px; max-height: 320px;
  background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
  display: flex; flex-direction: column; overflow: hidden;
  font-family: system-ui, sans-serif; font-size: 14px; color: #111b21; }
.qr-input { border: none; border-bottom: 1px solid #e9edef; padding: 10px 12px;
  font: inherit; outline: none; }
.qr-list { overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
.qr-item { padding: 7px 12px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.qr-item.qr-active { background: #f0f2f5; }
.qr-item .qr-title { font-weight: 600; white-space: nowrap; }
.qr-item .qr-shortcut { font-family: monospace; color: #008069; }
.qr-item .qr-body { color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qr-empty { padding: 12px; color: #667781; }
`;

export class Picker {
  private panel: HTMLDivElement | null = null;
  private input!: HTMLInputElement;
  private listEl!: HTMLUListElement;
  private templates: Template[] = [];
  private matches: Template[] = [];
  private active = 0;

  constructor(private onSelect: (tpl: Template) => void) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  async openAt(anchor: DOMRect): Promise<void> {
    if (this.isOpen) return;
    this.templates = await getTemplates();

    const style = document.createElement("style");
    style.textContent = CSS;

    this.panel = document.createElement("div");
    this.panel.className = "qr-panel";
    this.panel.appendChild(style);

    this.input = document.createElement("input");
    this.input.className = "qr-input";
    this.input.placeholder = t("pickerPlaceholder");
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    this.listEl = document.createElement("ul");
    this.listEl.className = "qr-list";

    this.panel.append(this.input, this.listEl);
    document.body.appendChild(this.panel);

    // Position above the compose box, clamped to the viewport.
    const height = 320;
    this.panel.style.left = `${Math.max(8, anchor.left)}px`;
    this.panel.style.top = `${Math.max(8, anchor.top - height - 8)}px`;

    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private refresh(): void {
    this.matches = rankTemplates(this.templates, this.input.value);
    this.active = 0;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (this.templates.length === 0 || this.matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "qr-empty";
      empty.textContent = t(this.templates.length === 0 ? "noTemplatesYet" : "noResults");
      this.listEl.appendChild(empty);
      return;
    }
    this.matches.forEach((tpl, i) => {
      const li = document.createElement("li");
      li.className = "qr-item" + (i === this.active ? " qr-active" : "");
      const title = document.createElement("span");
      title.className = "qr-title";
      title.textContent = tpl.title;
      const shortcut = document.createElement("span");
      shortcut.className = "qr-shortcut";
      shortcut.textContent = tpl.shortcut ? `/${tpl.shortcut}` : "";
      const body = document.createElement("span");
      body.className = "qr-body";
      body.textContent = tpl.body;
      li.append(title, shortcut, body);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus so insertion targets the compose box
        this.pick(i);
      });
      this.listEl.appendChild(li);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.active = Math.min(this.active + 1, this.matches.length - 1);
      this.renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.active = Math.max(this.active - 1, 0);
      this.renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.pick(this.active);
    }
  }

  private pick(index: number): void {
    const tpl = this.matches[index];
    if (!tpl) return;
    this.close();
    this.onSelect(tpl);
  }
}
```

- [ ] **Step 2: Replace `src/content/index.ts` (delete the stub)**

```ts
import type { Template } from "../lib/types";
import { fillTemplate } from "../lib/template";
import { incrementUsage } from "../lib/storage";
import { getComposeBox, getChatName, insertText } from "./whatsappAdapter";
import { Picker } from "./picker";

const t = (key: string): string => chrome.i18n.getMessage(key) || key;

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
    "background:#111b21;color:#fff;padding:10px 16px;border-radius:8px;" +
    "z-index:10000;font-family:system-ui,sans-serif;font-size:14px;";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

const picker = new Picker((tpl: Template) => {
  void insertTemplate(tpl);
});

async function insertTemplate(tpl: Template): Promise<void> {
  const name = getChatName() ?? "";
  const text = fillTemplate(tpl.body, { name });
  if (insertText(text)) {
    await incrementUsage(tpl.id);
  } else {
    showToast(t("openChatFirst"));
  }
}

function openPicker(): void {
  const box = getComposeBox();
  if (!box) {
    showToast(t("openChatFirst"));
    return;
  }
  void picker.openAt(box.getBoundingClientRect());
}

document.addEventListener(
  "keydown",
  (e) => {
    // Ctrl+/ toggles the picker anywhere on the page.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "/") {
      e.preventDefault();
      e.stopPropagation();
      if (picker.isOpen) picker.close();
      else openPicker();
      return;
    }
    // "/" in an empty, focused compose box opens the picker.
    if (e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey && !picker.isOpen) {
      const box = getComposeBox();
      const active = document.activeElement;
      const boxFocused = box !== null && (box === active || box.contains(active));
      if (box && boxFocused && (box.textContent ?? "").trim() === "") {
        e.preventDefault();
        e.stopPropagation();
        openPicker();
      }
    }
  },
  true // capture, so we run before WhatsApp's own handlers
);
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck` — expected: no errors.
Run: `npm run build` — expected: fresh `dist/content.js`.

- [ ] **Step 4: Manual test on live WhatsApp Web**

Reload the unpacked extension, hard-reload the WhatsApp Web tab, then verify each of these:

1. `Ctrl+/` with a chat open → picker appears above the compose box.
2. Typing filters; ↑/↓ moves the highlight; Esc closes; `Ctrl+/` again toggles.
3. Enter on a template containing `{name}` → text lands in the compose box with the chat's display name filled in; **the message is NOT sent**.
4. A template with an unknown placeholder (e.g. `{date}`) → inserted with `{date}` still visible.
5. Click-selection works like Enter.
6. `/` pressed in an **empty** compose box opens the picker; `/` typed mid-message does not.
7. `Ctrl+/` on the chat-list screen (no chat open) → toast with the "open a chat first" message, no crash.
8. In a group chat, `{name}` fills with the group's name (acceptable v1 behavior).
9. Insert twice from the same template, then reopen the picker with an empty query → that template ranks higher (usage counting works).

- [ ] **Step 5: Commit**

```bash
git add src/content
git commit -m "feat: picker overlay with keyboard nav, hotkeys, name auto-fill"
```

---

### Task 9: Packaging, store assets, release checklist

**Files:**
- Create: `public/icons/icon16.png`, `public/icons/icon48.png`, `public/icons/icon128.png`, `scripts/make-icons.mjs`, `docs/release-checklist.md`, `docs/privacy-policy.md`, `docs/store-listing.md`, `README.md`
- Modify: `public/manifest.json` (add icons), `package.json` (add `zip` script + sharp devDependency)

**Interfaces:**
- Consumes: the built `dist/` from all prior tasks.
- Produces: `quickreply.zip` ready for Chrome Web Store upload, plus the listing documents.

- [ ] **Step 1: Add sharp and create `scripts/make-icons.mjs`**

Run: `npm install --save-dev sharp`

```js
// scripts/make-icons.mjs — renders the logo SVG to the three required PNG sizes.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#008069"/>
  <path d="M34 44h60v10H34zm0 20h60v10H34zm0 20h36v10H34z" fill="#fff"/>
  <path d="M92 78l14 14-8 4-6-6z" fill="#ffd54f"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
  console.log(`icon${size}.png written`);
}
```

Run: `node scripts/make-icons.mjs`
Expected: three PNGs in `public/icons/`. (This placeholder logo is fine for v1; a nicer one can replace the SVG string any time.)

- [ ] **Step 2: Add icons to `public/manifest.json`**

Add these keys to the existing manifest object (keep everything else unchanged):

```json
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

- [ ] **Step 3: Add zip script to `package.json`**

Add to `"scripts"` (Windows PowerShell; adjust if ever building on another OS):

```json
"zip": "npm run build && powershell -Command \"Compress-Archive -Path dist/* -DestinationPath quickreply.zip -Force\""
```

Run: `npm run zip`
Expected: `quickreply.zip` created at repo root, containing `manifest.json` at the zip's top level (verify by opening the zip — the Web Store rejects zips where the manifest is nested in a subfolder).

- [ ] **Step 4: Create `docs/privacy-policy.md`**

```markdown
# QuickReply for WhatsApp Web — Privacy Policy

Effective date: <fill in on publish day>

QuickReply stores your message templates and settings **locally in your
browser** using Chrome's extension storage. That is the only data it touches.

- We do not collect, transmit, sell, or share any data. There are no servers.
- The extension makes no network requests.
- Your templates never leave your device unless you use the Export button,
  which saves a file to your own computer.
- The extension reads the WhatsApp Web page only to place text you chose into
  the message box. It never reads your message history and never sends
  messages on your behalf.
- Uninstalling the extension deletes all stored data.

Contact: bayuronald@hotmail.com
```

- [ ] **Step 5: Create `docs/store-listing.md`** (draft copy for the Web Store form)

```markdown
# Chrome Web Store listing draft

**Name (en):** QuickReply for WhatsApp Web
**Name (id):** QuickReply untuk WhatsApp Web

**Summary (en):** Answer customers in two keystrokes — message templates with
auto-filled variables, right inside WhatsApp Web.
**Summary (id):** Balas pelanggan dengan dua tombol — template pesan dengan
variabel otomatis, langsung di WhatsApp Web.

**Description (en):**
Selling on WhatsApp means typing the same answers all day. QuickReply gives
you a template library one keystroke away: press Ctrl+/ (or type "/" in an
empty message box), search, hit Enter — done. {name} is filled with the
customer's name automatically. Your most-used templates rise to the top.
Everything is stored locally in your browser: no account, no servers, no
data collection. QuickReply never sends messages for you — you always press
send yourself, so your account stays safe.

**Description (id):**
Jualan lewat WhatsApp berarti mengetik jawaban yang sama sepanjang hari.
QuickReply menyediakan pustaka template yang bisa dipanggil dengan satu
tombol: tekan Ctrl+/ (atau ketik "/" di kotak pesan kosong), cari, tekan
Enter — selesai. {name} terisi otomatis dengan nama pelanggan. Template yang
paling sering dipakai muncul paling atas. Semua tersimpan lokal di browser
Anda: tanpa akun, tanpa server, tanpa pengumpulan data. QuickReply tidak
pernah mengirim pesan untuk Anda — Anda selalu menekan kirim sendiri,
sehingga akun Anda tetap aman.

**Category:** Workflow & Planning (or Communication)
**Language:** English + Indonesian

**Screenshots needed (1280x800):**
1. Picker open over a (demo) chat, query typed, results showing
2. Template inserted with {name} filled, finger hovering send
3. Options page with a healthy template list
4. Close-up of the placeholder hint / template editor

Use a demo WhatsApp account with fake contacts for screenshots — never real
customer data.

**Privacy tab answers:** no data collected (all questionnaire rows: "No");
single purpose: insert user-authored message templates into WhatsApp Web's
compose box; storage permission justification: templates are stored locally;
host permission justification: the picker and insertion only work on
web.whatsapp.com.
```

- [ ] **Step 6: Create `docs/release-checklist.md`** (the manual test script from the spec — run before every release)

```markdown
# Release checklist — run on live WhatsApp Web before every store submission

Build: `npm test` all green → `npm run typecheck` clean → `npm run zip`.
Load the fresh `dist/` unpacked in BOTH Chrome and Edge, then in each:

- [ ] Options: add / edit / delete a template; counter updates
- [ ] Options: export downloads JSON; importing it back appends
- [ ] Options: importing an invalid file shows error, data untouched
- [ ] Ctrl+/ opens picker over compose box; Esc closes; Ctrl+/ toggles
- [ ] "/" in EMPTY compose box opens picker; "/" mid-message does not
- [ ] Enter inserts template; message is NOT auto-sent
- [ ] {name} fills from open 1:1 chat; unknown {placeholders} stay visible
- [ ] Group chat: no crash ({name} = group name is acceptable)
- [ ] No chat open + Ctrl+/ → friendly toast, no crash
- [ ] Usage ranking: most-inserted template first on empty query
- [ ] UI language: English and Indonesian both render (launch with --lang=id)
- [ ] DevTools console: no errors from content.js during all of the above
- [ ] manifest.json in zip top level; version bumped from last release
```

- [ ] **Step 7: Create `README.md`**

```markdown
# QuickReply for WhatsApp Web

Answer customers in two keystrokes: reusable message templates with
auto-filled variables, inside WhatsApp Web. MV3 extension for Chrome/Edge.

## Develop

- `npm install`
- `npm test` — unit tests (Vitest) for the pure-logic modules in `src/lib/`
- `npm run build` — builds options page + content script into `dist/`
- Load `dist/` unpacked via chrome://extensions (Developer mode)
- `npm run zip` — store-ready `quickreply.zip`

## Architecture

- `src/lib/` — pure logic (template engine, search, storage, import/export); TDD lives here
- `src/options/` — options page (plain DOM)
- `src/content/whatsappAdapter.ts` — **the only file that knows WhatsApp's DOM.**
  When WhatsApp Web changes HTML, fix the `SELECTORS` there and nothing else.
- `src/content/` — picker overlay + hotkey wiring

## Principles

Never auto-send. No servers, no accounts, no telemetry. See
`docs/superpowers/specs/2026-07-10-whatsapp-quickreply-design.md`.
```

- [ ] **Step 8: Full verification**

Run: `npm test` — expected: all suites pass.
Run: `npm run typecheck` — expected: clean.
Run: `npm run zip` — expected: fresh `quickreply.zip`.
Run the release checklist end-to-end once (both browsers).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: icons, zip packaging, privacy policy, store listing, release checklist"
```

---

## Post-plan (not tasks): store submission

Submitting to the Chrome Web Store is done by Bayu in a browser (developer account registration costs a one-time $5, needs a payment card): create the developer account, upload `quickreply.zip`, paste in the listing copy from `docs/store-listing.md`, upload screenshots, host the privacy policy (a public GitHub repo file or Gist URL is accepted), submit for review. Review typically takes 1–5 days. Edge Add-ons store submission (free) can reuse the same zip and copy.
