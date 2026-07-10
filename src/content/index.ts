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

const picker = new Picker(
  (tpl: Template) => {
    void insertTemplate(tpl);
  },
  () => getComposeBox()?.focus() // dismissing the picker returns you to typing
);

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
