import type { Template } from "../lib/types";
import type { Reminder } from "../lib/types";
import { rankTemplates } from "../lib/search";
import { getTemplates } from "../lib/storage";
import { canAddReminder, getReminders, presetDueAt, saveReminder } from "../lib/reminders";
import type { ReminderPreset } from "../lib/reminders";
import type { FillField } from "../lib/fillForm";
import { isProActive } from "../lib/entitlements";

const t = (key: string, substitutions?: string[]): string => {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key; // extension context invalidated; keys are readable English
  }
};

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
.qr-remind { padding: 8px 12px; cursor: pointer; color: #008069; font-weight: 600;
  border-bottom: 1px solid #e9edef; }
.qr-remind.qr-active { background: #f0f2f5; }
.qr-step { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.qr-step h3 { margin: 0; font-size: 14px; }
.qr-preset { text-align: left; border: 1px solid #d1d7db; background: #fff; border-radius: 8px;
  padding: 8px 10px; cursor: pointer; font: inherit; color: inherit; }
.qr-preset:hover { background: #f0f2f5; }
.qr-note, .qr-custom { border: 1px solid #d1d7db; border-radius: 8px; padding: 8px 10px; font: inherit; }
.qr-error { color: #c5221f; font-size: 13px; margin: 0; }
.qr-row { display: flex; gap: 8px; }
.qr-btn { border: 1px solid #d1d7db; background: #fff; border-radius: 8px; padding: 8px 12px;
  cursor: pointer; font: inherit; color: inherit; }
.qr-btn.qr-primary { background: #008069; border-color: #008069; color: #fff; }
.qr-fill-label { display: flex; flex-direction: column; gap: 3px; }
.qr-fill-label span { font-family: monospace; font-size: 12px; color: #667781; }
.qr-prefilled { color: #8696a0; }
`;

export class Picker {
  private panel: HTMLDivElement | null = null;
  private opening = false;
  private input!: HTMLInputElement;
  private listEl!: HTMLUListElement;
  private templates: Template[] = [];
  private matches: Template[] = [];
  private active = 0;
  private view: "list" | "reminder" | "fill" = "list";
  private reminderError = "";
  private fillTpl: Template | null = null;

  constructor(
    private onSelect: (tpl: Template) => void,
    private onDismiss?: () => void,
    private getChatName: () => string | null = () => null,
    private getFillFields: (tpl: Template) => Promise<FillField[] | null> = async () => null,
    private onFillSubmit: (tpl: Template, values: Record<string, string>) => void = () => {}
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

      this.view = "list";
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
    this.view = "list";
    this.fillTpl = null;
  }

  private refresh(): void {
    this.matches = rankTemplates(this.templates, this.input.value);
    this.active = 0;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    const chatOpen = this.getChatName() !== null;
    if (chatOpen) {
      const row = document.createElement("div");
      row.className = "qr-remind" + (this.active === -1 ? " qr-active" : "");
      row.textContent = t("remindMeRow");
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void this.openReminderStep();
      });
      this.listEl.appendChild(row);
    }
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
      this.active = Math.max(this.active - 1, this.getChatName() !== null ? -1 : 0);
      this.renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (this.active === -1) {
        void this.openReminderStep();
      } else {
        this.pick(this.active);
      }
    }
  }

  private pick(index: number): void {
    const tpl = this.matches[index];
    if (!tpl) return;
    void this.getFillFields(tpl).then((fields) => {
      if (!fields) {
        this.close();
        this.onSelect(tpl);
        return;
      }
      this.fillTpl = tpl;
      this.view = "fill";
      this.renderFillForm(fields);
    });
  }

  private renderFillForm(fields: FillField[]): void {
    this.input.hidden = true;
    this.listEl.replaceChildren();
    const tpl = this.fillTpl;
    if (!tpl) return;
    const step = document.createElement("div");
    step.className = "qr-step";
    const heading = document.createElement("h3");
    heading.textContent = t("fillFormTitle");
    step.appendChild(heading);

    const inputs = new Map<string, HTMLInputElement>();
    for (const field of fields) {
      const label = document.createElement("label");
      label.className = "qr-fill-label";
      const caption = document.createElement("span");
      caption.textContent = `{${field.key}}`;
      const input = document.createElement("input");
      input.className = "qr-note" + (field.auto ? " qr-prefilled" : "");
      input.value = field.value;
      if (field.auto) {
        // Greyed until the user overrides it.
        input.addEventListener("input", () => input.classList.remove("qr-prefilled"), { once: true });
      }
      inputs.set(field.key, input);
      label.append(caption, input);
      step.appendChild(label);
    }

    const submit = (): void => {
      const values: Record<string, string> = {};
      for (const [key, input] of inputs) values[key] = input.value;
      const chosen = this.fillTpl;
      this.close();
      if (chosen) this.onFillSubmit(chosen, values);
    };

    step.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    });

    const insert = document.createElement("button");
    insert.className = "qr-btn qr-primary";
    insert.textContent = t("insert");
    insert.addEventListener("mousedown", (e) => {
      e.preventDefault();
      submit();
    });
    const back = document.createElement("button");
    back.className = "qr-btn";
    back.textContent = t("back");
    back.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.fillTpl = null;
      this.backToList();
    });
    const row = document.createElement("div");
    row.className = "qr-row";
    row.append(insert, back);
    step.appendChild(row);
    this.listEl.appendChild(step);
    // Focus the first blank the user must fill, else the first input.
    const firstBlank = fields.find((f) => !f.auto);
    (firstBlank ? inputs.get(firstBlank.key) : [...inputs.values()][0])?.focus();
  }

  /** Esc semantics: second-step views return to the list; list view closes. */
  escape(): "closed" | "handled" {
    if (this.view !== "list") {
      this.backToList();
      return "handled";
    }
    this.close();
    return "closed";
  }

  private async openReminderStep(): Promise<void> {
    const reminders = await getReminders();
    const pro = await isProActive();
    this.view = "reminder";
    this.reminderError = "";
    if (!canAddReminder(reminders, pro)) {
      this.renderCapNotice();
      return;
    }
    this.renderReminderStep();
  }

  private renderCapNotice(): void {
    this.input.hidden = true;
    this.listEl.replaceChildren();
    const step = document.createElement("div");
    step.className = "qr-step";
    const msg = document.createElement("p");
    msg.textContent = t("reminderCapReached");
    msg.style.margin = "0";
    const upgrade = document.createElement("button");
    upgrade.className = "qr-btn qr-primary";
    upgrade.textContent = t("upgradeToPro");
    upgrade.addEventListener("mousedown", (e) => {
      e.preventDefault();
      try {
        void chrome.runtime.sendMessage({ type: "qr-open-options" });
      } catch {
        // extension context gone; nothing to do
      }
      this.dismiss();
    });
    const back = document.createElement("button");
    back.className = "qr-btn";
    back.textContent = t("back");
    back.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.backToList();
    });
    const row = document.createElement("div");
    row.className = "qr-row";
    row.append(upgrade, back);
    step.append(msg, row);
    this.listEl.appendChild(step);
  }

  private renderReminderStep(): void {
    this.input.hidden = true;
    this.listEl.replaceChildren();
    const chatName = this.getChatName() ?? "";
    const step = document.createElement("div");
    step.className = "qr-step";

    const heading = document.createElement("h3");
    heading.textContent = t("reminderFor", [chatName]);

    const note = document.createElement("input");
    note.className = "qr-note";
    note.placeholder = t("reminderNotePlaceholder");
    note.maxLength = 120;

    const presets: Array<[ReminderPreset, string]> = [
      ["1h", t("preset1h")],
      ["3h", t("preset3h")],
      ["tomorrow9", t("presetTomorrow")],
    ];
    const presetBtns = presets.map(([preset, label]) => {
      const b = document.createElement("button");
      b.className = "qr-preset";
      b.textContent = label;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void this.createReminder(chatName, presetDueAt(preset, new Date()), note.value.trim());
      });
      return b;
    });

    const custom = document.createElement("input");
    custom.type = "datetime-local";
    custom.className = "qr-custom";

    const error = document.createElement("p");
    error.className = "qr-error";
    error.textContent = this.reminderError;

    const set = document.createElement("button");
    set.className = "qr-btn qr-primary";
    set.textContent = t("setReminder");
    set.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const when = custom.value ? new Date(custom.value).getTime() : NaN;
      if (!Number.isFinite(when) || when <= Date.now()) {
        this.reminderError = t("invalidTime");
        this.renderReminderStep();
        return;
      }
      void this.createReminder(chatName, when, note.value.trim());
    });

    const back = document.createElement("button");
    back.className = "qr-btn";
    back.textContent = t("back");
    back.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.backToList();
    });

    const row = document.createElement("div");
    row.className = "qr-row";
    row.append(set, back);
    step.append(heading, note, ...presetBtns, custom, error, row);
    this.listEl.appendChild(step);
    note.focus();
  }

  private backToList(): void {
    this.view = "list";
    this.reminderError = "";
    this.fillTpl = null;
    this.input.hidden = false;
    this.refresh();
    this.input.focus();
  }

  private async createReminder(chatName: string, dueAt: number, note: string): Promise<void> {
    const r: Reminder = {
      id: crypto.randomUUID(),
      chatName,
      note,
      dueAt,
      createdAt: Date.now(),
      status: "pending",
    };
    try {
      await saveReminder(r);
    } catch {
      // storage failed; leave the step open so the user can retry
      return;
    }
    this.dismiss();
  }
}
