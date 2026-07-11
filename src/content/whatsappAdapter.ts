/**
 * QUARANTINE MODULE — the only file allowed to know WhatsApp's DOM.
 * When WhatsApp Web changes its HTML, fix the SELECTORS below and nothing else.
 * HARD RULE: this module never triggers message sending.
 */
const SELECTORS = {
  appRoot: "#app",
  // The compose box is a contenteditable div inside the footer of the open chat.
  composeBox: 'footer div[contenteditable="true"]',
  // The open chat's name: the first dir="auto" span in the #main header.
  // Verified live 2026-07-10: the name span carries no title attribute, while
  // the status line ("online") is a span[title] and is NOT dir="auto" — so
  // span[title] must not be used here or {name} fills with "online".
  chatHeader: '#main header span[dir="auto"]',
  // Sidebar chat rows: each row contains a span[title="<chat name>"].
  // (In the chat LIST the title attribute is present — unlike the #main
  // header, where it is absent; both verified live 2026-07-10/11.)
  sidebarChatTitle: "#pane-side span[title]",
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

/**
 * Snapshot the caret position inside the compose box, taken BEFORE the
 * picker steals focus (focusing the box later resets its caret to the
 * start). Returns null when the caret isn't in the compose box.
 */
export function captureCaret(): Range | null {
  const box = getComposeBox();
  const sel = window.getSelection();
  if (!box || !sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return box.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

export function insertText(text: string, caret?: Range | null): boolean {
  const box = getComposeBox();
  if (!box) return false;
  box.focus();
  const sel = window.getSelection();
  if (sel) {
    if (caret && box.contains(caret.commonAncestorContainer)) {
      // Restore where the user was typing when the picker opened.
      sel.removeAllRanges();
      sel.addRange(caret);
    } else if ((box.textContent ?? "") !== "") {
      // No usable caret: append at the end — never at the start.
      const end = document.createRange();
      end.selectNodeContents(box);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
  }
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
