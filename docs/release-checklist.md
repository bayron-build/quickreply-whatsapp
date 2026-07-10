# Release checklist — run on live WhatsApp Web before every store submission

Build: `npm test` all green → `npm run typecheck` clean → `npm run zip`.
Load the fresh `dist/` unpacked in BOTH Chrome and Edge, then in each:

- [ ] Options: add / edit / delete a template; counter updates
- [ ] Options: export downloads JSON; importing it back appends
- [ ] Options: importing an invalid file shows error, data untouched
- [ ] Ctrl+/ opens picker over compose box; Esc closes; Ctrl+/ toggles
- [ ] Backspace on an EMPTY picker query closes the picker; Esc / Backspace / Ctrl+/ all return focus to the compose box
- [ ] "/" in EMPTY compose box opens picker; "/" mid-message does not
- [ ] Enter inserts template; message is NOT auto-sent
- [ ] {name} fills from open 1:1 chat; unknown {placeholders} stay visible
- [ ] {name} fills the CONTACT NAME (not "online"/"typing…") while the status line is visible under the name — regression guard for the 2026-07-10 selector bug
- [ ] Group chat: no crash ({name} = group name is acceptable)
- [ ] No chat open + Ctrl+/ → friendly toast, no crash
- [ ] Usage ranking: most-inserted template first on empty query
- [ ] UI language: English and Indonesian both render (launch with --lang=id)
- [ ] DevTools console: no errors from content.js during all of the above
- [ ] manifest.json in zip top level; version bumped from last release; entry paths use forward slashes
