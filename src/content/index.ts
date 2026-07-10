import type { Template } from "../lib/types";
import { fillTemplate } from "../lib/template";
import { systemPlaceholders } from "../lib/systemVars";
import { incrementUsage } from "../lib/storage";
import { captureCaret, getComposeBox, getChatName, insertText } from "./whatsappAdapter";
import { Picker } from "./picker";

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key; // extension context gone; caller shows a hardcoded notice
  }
};

// When the extension is reloaded/auto-updated, content scripts already
// running in open tabs are orphaned: every chrome.* API dies. Detect it so
// users get a refresh hint instead of console errors. i18n is dead too,
// so this fallback is hardcoded (English, per product decision 2026-07-10).
const REFRESH_MSG = "QuickReply was updated — refresh this page (Ctrl+R).";

function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

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

const picker = new Picker(
  (tpl: Template) => {
    void insertTemplate(tpl);
  },
  () => getComposeBox()?.focus() // dismissing the picker returns you to typing
);

// Caret position in the compose box, snapshotted when the picker opens —
// opening the picker moves focus, which loses the user's typing position.
let savedCaret: Range | null = null;

async function insertTemplate(tpl: Template): Promise<void> {
  const name = getChatName() ?? "";
  const text = fillTemplate(tpl.body, {
    ...systemPlaceholders(new Date(), navigator.language),
    name,
  });
  const caret = savedCaret;
  savedCaret = null;
  if (insertText(text, caret)) {
    try {
      await incrementUsage(tpl.id);
    } catch {
      // Context died mid-session; the insert already succeeded and usage
      // counting is best-effort — never surface an error for it.
    }
  } else {
    showToast(t("openChatFirst"));
  }
}

function openPicker(): void {
  if (!extensionAlive()) {
    showToast(REFRESH_MSG);
    return;
  }
  const box = getComposeBox();
  if (!box) {
    showToast(t("openChatFirst"));
    return;
  }
  savedCaret = captureCaret();
  void picker.openAt(box.getBoundingClientRect());
}

// The panel is fixed-positioned at open time; on resize its anchor moves out
// from under it, so dismiss rather than strand it off-screen.
window.addEventListener("resize", () => {
  if (picker.isOpen) {
    picker.close();
    getComposeBox()?.focus();
  }
});

document.addEventListener(
  "keydown",
  (e) => {
    // Esc closes the picker no matter what has focus — and must not reach
    // WhatsApp, which would close the open chat.
    if (e.key === "Escape" && picker.isOpen) {
      e.preventDefault();
      e.stopPropagation();
      picker.close();
      getComposeBox()?.focus();
      return;
    }
    // Ctrl+/ toggles the picker anywhere on the page.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "/") {
      e.preventDefault();
      e.stopPropagation();
      if (picker.isOpen) {
        picker.close();
        getComposeBox()?.focus();
      } else {
        openPicker();
      }
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
