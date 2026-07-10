import type { Template } from "../lib/types";
import { rankTemplates } from "../lib/search";
import { getTemplates } from "../lib/storage";

const t = (key: string): string => chrome.i18n.getMessage(key) || key;

const CSS = `
.qr-panel { position: fixed; z-index: 9999; width: 380px; max-height: 320px;
  background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
  display: flex; flex-direction: column; overflow: hidden;
  font-family: system-ui, sans-serif; font-size: 14px; color: #111b21; }
.qr-input { border: none; border-bottom: 1px solid #e9edef; padding: 10px 12px;
  font: inherit; outline: none; }
.qr-list { overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
.qr-item { padding: 7px 12px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.qr-item.qr-active { background: #f0f2f5; }
.qr-item .qr-title { font-weight: 600; white-space: nowrap; }
.qr-item .qr-shortcut { font-family: monospace; color: #008069; }
.qr-item .qr-body { color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qr-empty { padding: 12px; color: #667781; }
@media (prefers-color-scheme: dark) {
  .qr-panel { background: #233138; color: #e9edef; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  .qr-input { background: transparent; color: inherit; border-bottom-color: #2a3942; }
  .qr-input::placeholder { color: #8696a0; }
  .qr-item.qr-active { background: #182229; }
  .qr-item .qr-shortcut { color: #06cf9c; }
  .qr-item .qr-body { color: #8696a0; }
  .qr-empty { color: #8696a0; }
}
`;

export class Picker {
  private panel: HTMLDivElement | null = null;
  private opening = false;
  private input!: HTMLInputElement;
  private listEl!: HTMLUListElement;
  private templates: Template[] = [];
  private matches: Template[] = [];
  private active = 0;

  constructor(
    private onSelect: (tpl: Template) => void,
    private onDismiss?: () => void
  ) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  async openAt(anchor: DOMRect): Promise<void> {
    if (this.isOpen || this.opening) return;
    this.opening = true;
    try {
      this.templates = await getTemplates();

      const style = document.createElement("style");
      style.textContent = CSS;

      this.panel = document.createElement("div");
      this.panel.className = "qr-panel";
      this.panel.appendChild(style);

      this.input = document.createElement("input");
      this.input.className = "qr-input";
      this.input.placeholder = t("pickerPlaceholder");
      this.input.addEventListener("input", () => this.refresh());
      this.input.addEventListener("keydown", (e) => this.onKey(e));

      this.listEl = document.createElement("ul");
      this.listEl.className = "qr-list";

      this.panel.append(this.input, this.listEl);
      document.body.appendChild(this.panel);

      // Position above the compose box, clamped to the viewport.
      const height = 320;
      this.panel.style.left = `${Math.max(8, anchor.left)}px`;
      this.panel.style.top = `${Math.max(8, anchor.top - height - 8)}px`;

      this.refresh();
      this.input.focus();
      document.addEventListener("mousedown", this.onDocMouseDown, true);
    } finally {
      this.opening = false;
    }
  }

  close(): void {
    document.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.panel?.remove();
    this.panel = null;
  }

  private refresh(): void {
    this.matches = rankTemplates(this.templates, this.input.value);
    this.active = 0;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (this.templates.length === 0 || this.matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "qr-empty";
      empty.textContent = t(this.templates.length === 0 ? "noTemplatesYet" : "noResults");
      this.listEl.appendChild(empty);
      return;
    }
    this.matches.forEach((tpl, i) => {
      const li = document.createElement("li");
      li.className = "qr-item" + (i === this.active ? " qr-active" : "");
      const title = document.createElement("span");
      title.className = "qr-title";
      title.textContent = tpl.title;
      const shortcut = document.createElement("span");
      shortcut.className = "qr-shortcut";
      shortcut.textContent = tpl.shortcut ? `/${tpl.shortcut}` : "";
      const body = document.createElement("span");
      body.className = "qr-body";
      body.textContent = tpl.body;
      li.append(title, shortcut, body);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus so insertion targets the compose box
        this.pick(i);
      });
      this.listEl.appendChild(li);
    });
    const activeEl = this.listEl.querySelector(".qr-active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  private dismiss(): void {
    this.close();
    this.onDismiss?.();
  }

  // Click anywhere outside the panel closes it. No refocus: the user's
  // click should land wherever they aimed it.
  private onDocMouseDown = (e: MouseEvent): void => {
    if (this.panel && e.target instanceof Node && !this.panel.contains(e.target)) {
      this.close();
    }
  };

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.dismiss();
    } else if (e.key === "Backspace" && this.input.value === "") {
      // Backspace on an empty query "undoes" the "/" that opened the picker.
      e.preventDefault();
      this.dismiss();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.active = Math.min(this.active + 1, this.matches.length - 1);
      this.renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.active = Math.max(this.active - 1, 0);
      this.renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.pick(this.active);
    }
  }

  private pick(index: number): void {
    const tpl = this.matches[index];
    if (!tpl) return;
    this.close();
    this.onSelect(tpl);
  }
}
