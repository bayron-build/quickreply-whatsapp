# Demo chat script for store screenshots

Setup: rename the helper's contact to **Dina** (their side needs no setup —
they just paste their lines). You are the seller. Send in this order, then
capture. Never screenshot real customer chats.

| # | Who | Message |
|---|-----|---------|
| 1 | Dina | Hi! Is the tote bag in navy blue still available? 😊 |
| 2 | You  | Yes it is! Ready stock 👍 |
| 3 | Dina | Great, I'll take one! How much including shipping? |
| 4 | You  | It's $12 + $3 shipping. You can transfer and send the receipt here 🙏 |
| 5 | Dina | Just paid! ✅ |
| 6 | You  | Payment received, thank you! Packing your order today 📦 |
| 7 | Dina | Awesome! Did it ship yet? |

Capture moments (viewport already at 1280×800 via DevTools device toolbar):

- **Shot 1:** press Ctrl+/, type `ship`, leave the highlight on
  "Order shipped" → capture (picker over the conversation).
- **Shot 2:** press Enter → compose box shows
  "Good news Dina — your order is on the way! 🚚 Tracking number: {tracking}…"
  → capture UNSENT. Shows {name} auto-filled AND a manual placeholder.
- **Shots 3 & 4:** options page (template list; then Edit on
  "Order confirmed" showing the placeholder hint).

Tip: if you actually send the final message afterwards, fill {tracking}
first — your helper will enjoy the confusion either way.
