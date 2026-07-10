# Release checklist — run on live WhatsApp Web before every store submission

Build: `npm test` all green → `npm run typecheck` clean → `npm run zip`.
Load the fresh `dist/` unpacked in BOTH Chrome and Edge, then in each:

- [ ] Options: add / edit / delete a template; counter updates
- [ ] Delete asks for confirmation; Cancel keeps the template; Edit (green) and Delete (red) are visually distinct
- [ ] Options: export downloads JSON; importing it back appends
- [ ] Options: importing an invalid file shows error, data untouched
- [ ] Ctrl+/ opens picker over compose box; Esc closes; Ctrl+/ toggles
- [ ] Backspace on an EMPTY picker query closes the picker; Esc / Backspace / Ctrl+/ all return focus to the compose box
- [ ] Resizing the browser window while the picker is open dismisses it (never stranded off-screen)
- [ ] Clicking anywhere outside the open picker closes it
- [ ] Esc closes the picker even when the picker input is NOT focused, and does NOT exit the WhatsApp chat
- [ ] Invalid import shows a popup alert; counter shows a plain template count (no /15 in v1)
- [ ] "/" in EMPTY compose box opens picker; "/" mid-message does not
- [ ] Enter inserts template; message is NOT auto-sent
- [ ] With text already typed: insertion lands AT THE CURSOR position held when the picker was opened (start, middle, end); never jumps to the front
- [ ] {name} fills from open 1:1 chat; unknown {placeholders} stay visible
- [ ] {today}/{time}/{tomorrow} (and {hari_ini}/{jam}/{besok}) auto-fill with locale-formatted values; {date} and other custom placeholders stay manual
- [ ] {name} fills the CONTACT NAME (not "online"/"typing…") while the status line is visible under the name — regression guard for the 2026-07-10 selector bug
- [ ] Group chat: no crash ({name} = group name is acceptable)
- [ ] No chat open + Ctrl+/ → friendly toast, no crash
- [ ] Usage ranking: most-inserted template first on empty query
- [ ] UI language: English and Indonesian both render (launch with --lang=id)
- [ ] Dark mode: with the OS/browser in dark theme, options page and picker are dark and legible; light theme likewise
- [ ] Orphaned-script case: reload the extension WITHOUT refreshing the WhatsApp tab, press Ctrl+/ → bilingual "refresh this page" toast, no console errors
- [ ] DevTools console: no errors from content.js during all of the above
- [ ] manifest.json in zip top level; version bumped from last release; entry paths use forward slashes
