# Roadmap notes — user-feedback-driven ideas

Ideas earned from real usage, not speculation. Candidates for v1.1+, to be
weighed against the planned Pro pillars (reminders + unlimited templates).

## Faster manual placeholders (from Bayu's own testing, 2026-07-10)

Pain: templates with several manual placeholders ({order}, {total},
{tracking}) still cost real typing time per message. Improving this does NOT
require becoming a CRM — the tool stays a typing accelerator:

1. **Fill-in form in the picker** (strongest candidate; likely Pro).
   When a chosen template has unfillable placeholders, the picker shows one
   small input per placeholder (Tab between them, Enter to insert the
   completed text). One focused UI moment instead of hunting through the
   composed message. No stored customer data → still not a CRM.
2. **System placeholders** — SHIPPED in v1 (2026-07-10): {today}, {time},
   {tomorrow} + Indonesian aliases {hari_ini}, {jam}, {besok}, locale-formatted.
   Deliberately NOT {date}: ambiguous keys must stay manual.
3. **{clipboard} placeholder** (great for the tracking-number flow):
   seller copies the resi number from the courier site, inserts the
   template, {clipboard} lands it inline. Needs clipboardRead permission —
   check store-review friction before committing.

## Options-page bulk actions (from Bayu's testing, 2026-07-10)

Multi-select (checkboxes) + "Delete selected" for cleaning up many templates
at once — came up after import testing created duplicates. Deferred from v1
to avoid pre-launch scope creep; pairs naturally with folders in v1.1.

## UX papercuts fixed post-review (for changelog)

- 2026-07-10: Backspace on empty picker query dismisses the picker; all
  dismissals (Esc / Backspace / Ctrl+/) return focus to the compose box.
- 2026-07-10: {name} selector fixed to read the contact name span
  (dir="auto"), not the "online" status span.
