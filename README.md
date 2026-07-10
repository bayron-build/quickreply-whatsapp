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

## License

Copyright (c) 2026 bayron. All rights reserved.

The source is public for transparency and portfolio purposes. You are
welcome to read it and learn from it, but copying, redistributing, or
republishing this extension (or derivatives of it) is not permitted.
