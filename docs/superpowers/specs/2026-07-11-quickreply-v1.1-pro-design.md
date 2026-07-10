# QuickReply v1.1 — Pro Tier Release Design

**Date:** 2026-07-11
**Status:** Design approved by Bayu (spec pending his review)
**Baseline:** v1.0.0, submitted to Chrome Web Store 2026-07-10 (in review). All v1 spec principles carry over except where explicitly amended here.

## Goals

Turn QuickReply from a free tool into a freemium product: ship the Pro tier (reminders, unlimited templates, fill-in form), the payment/licensing machinery, and a round of free-tier polish — while keeping every promise made to v1 users (nothing ever deleted, locked, or hidden by an update).

## Free / Pro Split

**Free (v1 features plus):**
- Multi-select delete in options
- WhatsApp-theme-matched dark mode for the picker
- **2 active reminders** (deliberate taste of the headline Pro feature; tasted features convert, locked ones don't)
- Up to 15 templates (cap NOW ENFORCED — semantics below)

**Pro:**
- Unlimited templates
- Unlimited reminders
- Fill-in placeholder form

**Pricing: configuration, not code.** Amounts live in the payment provider's dashboard and one display string in the options page. Launch prices are decided at Pro-launch time with real install data; nothing in the codebase hardcodes a price. Working defaults for copy mockups: $3/mo, $25/yr.

## Feature 1: Follow-up Reminders

**Setting a reminder:** `Ctrl+/` → a pinned "⏰ Remind me about this chat" row above the template list → second step with presets (1 hour, 3 hours, tomorrow 09:00, custom date+time) plus an optional short note. The reminder is bound to the currently open chat's name (via the adapter).

**Storage:** new `reminders` key in chrome.storage.local; `schemaVersion` bumps 1 → 2 (migration = add empty array; templates untouched).

```
Reminder {
  id: string          // uuid
  chatName: string    // adapter's getChatName() at creation time
  note: string        // optional, may be ""
  dueAt: number       // epoch ms
  createdAt: number
  status: "pending" | "fired" | "dismissed"
}
```

**Firing:** a background service worker (first one in this codebase) registers one `chrome.alarms` alarm per pending reminder (alarm name = reminder id). On fire: desktop notification ("Follow up: {chatName}" + note as body) and a badge count on the toolbar icon. On browser startup, a sweep fires any reminders missed while the browser was closed. Badge clears as reminders are dismissed/handled.

**Notification click:** focus (or open) the WhatsApp Web tab — findable via `chrome.tabs.query` against our existing host permission, no new `tabs` permission — then message the content script, which navigates to the chat via a new adapter function (`openChatByName`: find the sidebar row matching the chat name, click it — pure navigation, NEVER sends anything). Fallback if the chat isn't found: WhatsApp is focused, nothing more.

**Gating:** free users may have at most `FREE_REMINDER_CAP = 2` reminders with status "pending"; creating a third prompts the upgrade UI. **Firing is never gated:** reminders that exist always fire, including after a downgrade — same never-hold-data-hostage principle as templates.

## Feature 2: Fill-in Placeholder Form (Pro)

When an inserted template contains placeholders that cannot auto-fill (e.g. {tracking}, {total}), the picker slides to a second step: one text input per unfillable placeholder, Tab moves between them, Enter inserts the completed text at the saved caret, Esc returns to the template list. Auto-fillable values ({name}, {today}, {time}, {tomorrow} + id aliases) are shown pre-filled and greyed, overridable. Free users keep v1 behavior (unknown placeholders inserted as visible text). Pure logic (placeholder→field model, fill assembly) is unit-tested; the form UI lives in the picker module.

## Feature 3: Payments & Licensing

**Provider: Lemon Squeezy** (merchant of record — handles global taxes, pays out to Indonesia; license API is CORS-open and designed for client-side activation). Fallback if onboarding fails: Paddle; the license module isolates provider specifics so a swap touches one file.

**Purchase flow:** options page gains an Upgrade section → "Upgrade to Pro" opens the hosted checkout in a new tab → buyer receives a license key by email → pastes it into the options page → extension calls the provider's license *activate* endpoint, stores `{ key, instanceId, plan, status, lastValidatedAt }` under a `license` storage key.

**Validation policy:** re-validate weekly (background worker alarm). **14-day offline grace:** Pro stays active if validation can't be reached for up to 14 days past `lastValidatedAt`. A confirmed-invalid license (refund, cancelled subscription past period end) soft-locks Pro: no new reminders beyond the free cap, no new templates beyond 15, no fill-in form — but ALL existing data stays, existing reminders still fire.

**Principle amendment (supersedes v1's "no network requests"):** the extension makes network requests ONLY to the payment provider's license API, ONLY for license activation/revalidation, ONLY when the user has entered a license key. No other network calls, no telemetry, ever. This is documented in the privacy policy and disclosed in the store data questionnaire (license key = authentication information, collected).

**License module contract:** pure state machine (`isPro(state, now)`, activation/validation transitions) unit-tested without network; a thin fetch layer around it.

## Feature 4: Template Cap Enforcement

Per the v1 spec's decided semantics: free users cannot ADD or IMPORT beyond 15 templates (imports partially apply up to the cap and report it; nothing existing is ever touched). Options counter becomes "N / 15 · Pro removes the limit" with an upgrade link (plain "N templates" display for Pro). The cap turns on in the same release that ships reminders — the sequencing rule (a positive capability must exist behind the first paywall anyone sees) is satisfied.

## Feature 5: Free-tier Polish

- **Multi-select delete:** checkboxes in the options template list + "Delete selected" with a single confirmation dialog.
- **WhatsApp-theme dark mode:** new adapter function `getTheme(): "light" | "dark" | null` reads WhatsApp's own theme state; the picker follows it (falling back to prefers-color-scheme when null). Options page keeps following the system.
- **Icon refresh:** replace the placeholder SVG in `scripts/make-icons.mjs` with a more distinctive mark (designed with Bayu during the build; flat/simple — must read at 16×16), regenerate the three PNGs.

## Store & Permission Consequences

- New permissions: `alarms`, `notifications`. Both narrow; the update triggers a fresh (possibly in-depth) review.
- Data questionnaire changes: "authentication information" (license key) now collected; certifications still all true.
- Privacy policy gains a licensing paragraph (what's sent to the provider, when, and nothing else).
- Listing copy gains a Pro section. Version: **1.1.0**.

## Architecture Notes

New/changed units, keeping the v1 quarantine discipline:
- `src/background/index.ts` — service worker: alarms, notifications, badge, startup sweep, weekly license revalidation. Talks to storage + license modules only.
- `src/lib/reminders.ts` — pure reminder logic (cap check, due/missed computation, status transitions); storage accessors alongside existing patterns.
- `src/lib/license.ts` — pure license state machine + provider fetch wrapper (single file that knows Lemon Squeezy).
- `src/lib/fillForm.ts` — pure model for the fill-in form (placeholders → fields → assembled text).
- `whatsappAdapter.ts` additions: `openChatByName(name)`, `getTheme()`. Still the only file that knows WhatsApp's DOM.
- Picker: reminder row + two second-step views (reminder presets; fill-in form).
- Options: upgrade section, license entry, multi-select delete, cap counter states.

## Error Handling

- Provider API unreachable → grace period logic; UI shows "Pro active (offline)" state, never blocks mid-grace.
- Invalid/garbled license key → clear inline error, nothing stored.
- Notification click with WhatsApp closed → open a new WhatsApp Web tab, navigate after load (adapter retries briefly); if navigation fails, the tab is open and focused — acceptable.
- Chat renamed/deleted before reminder fires → notification still fires with stored name; navigation falls back gracefully.
- Alarm/notification permission anomalies surface in the options page, never crash the content script.

## Testing

- Vitest on all pure logic: reminder scheduling/cap/missed-alarm math, license state machine (fresh/valid/grace/expired/invalid paths), fill-form model, import-partial-apply at cap.
- Background worker's chrome.* usage kept thin enough to review by hand; release checklist gains sections: reminders end-to-end (set, fire, click-through, missed-while-closed), upgrade flow with a real test purchase (LS test mode), cap behaviors, downgrade behavior, theme matching.

## Build Order (shippable at every stage)

1. Reminders: storage/logic → background worker → picker row → notifications → click-through navigation
2. Fill-in form
3. Free extras (multi-select delete, theme matching, icon)
4. License module + upgrade UI (LS test mode)
5. Cap + Pro gating wired to license state
6. Store assets refresh + checklist run + submit 1.1.0

## Out of Scope (launch kit — separate track, planned when v1 is approved)

Promo video, refreshed screenshots with Pro features, landing page (needed when there's a price to explain), advertising/distribution plan (Indonesian seller communities, TikTok), Edge Add-ons submission of v1 (Bayu, ~20 min, any time). None of these are build tasks.

## Success Criteria

- v1.1.0 live on the store with reminders demonstrably working end-to-end (set → fire → click → right chat opens).
- A real test purchase activates Pro; refunding it soft-locks Pro without data loss.
- A v1 user with >15 templates updates and loses nothing, sees the new counter, and can still use every existing template.
- All pure-logic modules unit-tested; full release checklist passes on Chrome + Edge.
