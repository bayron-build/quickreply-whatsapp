# QuickReply for WhatsApp Web — v1 Design

**Date:** 2026-07-10
**Status:** Approved by Bayu (pending spec review)
**Working name:** QuickReply for WhatsApp Web (store name TBD before submission)

## Context & Goals

Bayu's goals, in priority order: learn to ship a real product end-to-end, earn modest revenue, produce a portfolio piece. Strategy: ship a small paid browser extension first (this project), then build a niche SaaS for WhatsApp-based sellers (project B) on the audience and lessons from this one.

**One-liner:** Answer customers in two keystrokes — reusable message templates with auto-filled variables, right inside WhatsApp Web.

**Target user:** Online sellers who handle high chat volume through WhatsApp Web on a desktop browser (Chrome/Edge). Core geography: Indonesia/SEA, but the product is not region-locked.

**Positioning:** Competitors (WA Web Plus, WAPlus CRM) are kitchen-sink CRM extensions. We are the focused, fast, clean tool for one job: answering customers quickly. Their existence is proof of a paying market.

**Roadmap context:**
- **v1 (this spec):** free template tool. ~2 weeks to Chrome Web Store.
- **v1.1 (project continues):** follow-up reminders + unlimited templates as a Pro tier ($3–5/month).
- **Later, only if users pull us there:** mini-CRM features (notes, labels, pipeline).

## Design Principles

1. **Never auto-send.** The extension inserts text; the human always presses send. This keeps users safe from WhatsApp account bans and keeps us clearly on the right side of WhatsApp's terms. This is permanent, not a v1 limitation.
2. **No servers, no accounts, no telemetry.** All data lives in `chrome.storage.local`. Nothing leaves the browser. Makes the store privacy questionnaire trivially clean and is a selling point.
3. **Quarantine the fragile part.** All code that touches WhatsApp's DOM lives in one module; everything else is pure, testable logic.

## v1 Feature Set

In scope:
- **Template library:** each template has a title, a shortcut word, and a message body that may contain `{placeholders}`.
- **Fast picker:** `Ctrl+/` (or typing `/` in an empty compose box) opens a search overlay anchored near the compose box. Fuzzy search by title/shortcut. Enter inserts the template into the compose box. Esc closes. Arrow keys navigate.
- **Variable auto-fill:** `{name}` is filled from the currently open chat's title. Any placeholder that cannot be auto-filled is inserted as visible editable text for the seller to fill manually.
- **Options page:** create, edit, delete templates; JSON export/import for backup.
- **Usage-ranked picker:** `usageCount` sorts most-used templates to the top.
- **i18n:** UI in English and Indonesian via Chrome's built-in i18n.

Explicitly out of v1: reminders, folders, cross-device sync, payments, analytics, auto-sending (permanently), mobile/WhatsApp Business API anything.

## Architecture

Chrome extension, **Manifest V3**, targeting Chrome and Edge.

**Stack:** TypeScript + Vite. No UI framework — plain DOM for the picker overlay and options page. Rationale: maximum learning value on fundamentals; TypeScript is the most portfolio-transferable skill in this project; the UI surface is small enough that a framework adds more weight than value.

**Components:**
1. **Content script** (injected into `web.whatsapp.com`): renders the picker overlay, handles hotkeys, performs insertion.
2. **WhatsApp DOM adapter** (single module, used only by the content script): finds the compose box, reads the open chat's display name, inserts text into WhatsApp's contenteditable editor. This is the only file that knows anything about WhatsApp's HTML. It exposes a capability check so callers degrade gracefully.
3. **Template engine** (pure TypeScript, no DOM): parse placeholders, fill variables, rank search results. Fully unit-testable.
4. **Options page:** template CRUD + import/export, talks only to the storage layer.
5. **Storage layer:** thin typed wrapper over `chrome.storage.local`.

No background service worker in v1 (nothing needs one). Permissions requested: `storage` plus host access to `web.whatsapp.com` only.

## Data Model

```
Template {
  id: string          // uuid
  title: string
  shortcut: string    // e.g. "ship" — typed after "/" for direct match
  body: string        // may contain {placeholders}
  createdAt: number   // epoch ms
  usageCount: number
}

Settings {
  hotkey: string      // default "Ctrl+/"
  language: "en" | "id" | "auto"   // default "auto" (follow browser)
}
```

Stored under `chrome.storage.local` keys `templates` (array) and `settings`. Schema carries a `schemaVersion` key for painless future migration (v1.1 adds a separate `reminders` store; templates are untouched).

## Error Handling

- **WhatsApp DOM not recognized** (WhatsApp shipped a UI change): the DOM adapter's capability check fails → picker shows a friendly "WhatsApp Web changed — an update is coming" notice. Typing in the chat is never blocked; nothing crashes.
- **`{name}` not detectable** (group chats, unusual layouts): placeholder is inserted as editable text. No error surfaced.
- **Import of invalid/corrupt JSON:** validated before any write; existing templates are never touched by a failed import.
- **Storage write failure:** surfaced as a visible error in the options page; export remains available.

## Testing

- **Unit tests (Vitest)** for the template engine and storage layer: placeholder parsing, variable filling, search ranking, import validation. This is the TDD learning ground.
- **Manual release checklist** for the DOM-dependent layer, run on real WhatsApp Web (Bayu's account) before every release: picker opens, search works, insertion works in 1:1 and group chats, `{name}` fills, graceful-degradation notice appears when the adapter is force-failed.
- Verified on Chrome and Edge before store submission.

## Ship Plan (~2 weeks)

- **Week 1:** template engine + storage + options page (buildable and testable with zero WhatsApp dependency).
- **Week 2:** DOM adapter + picker overlay on real WhatsApp Web; polish; store assets (name, screenshots, description in EN+ID, privacy policy page); submit for review.
- Chrome review typically takes a few days; project B design work starts during that window.

## Success Criteria

- Live on the Chrome Web Store.
- Bayu can demo the full loop in a real chat: `Ctrl+/` → search → Enter → `{name}` filled → send.
- First organic installs and at least one piece of user feedback (review or store feedback) to inform v1.1.

## Known Risks

- **WhatsApp DOM churn:** accepted; mitigated by the quarantined adapter + graceful degradation. Maintenance is part of the moat (it keeps lazy competitors out).
- **Store review rejection:** mitigated by minimal permissions, no remote code, honest listing copy.
- **Extension-blindness of mobile users:** out of scope by design; the high-volume sellers we target work on desktop, and phone users already have native quick replies in the WhatsApp Business app.
