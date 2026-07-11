import type { Template } from "../lib/types";
import { FREE_TEMPLATE_CAP, FREE_REMINDER_CAP } from "../lib/types";
import { getTemplates, saveTemplate, deleteTemplate, deleteTemplates } from "../lib/storage";
import { getReminders, deleteReminder, formatDueAt, countPending } from "../lib/reminders";
import { exportToJson, parseImport, capImport } from "../lib/importExport";
import { proView, activateLicense, deactivateLicense, getLicense, saveLicense } from "../lib/license";
import { isProActive } from "../lib/entitlements";
import { CHECKOUT_URL, PRICE_DISPLAY } from "../lib/proConfig";

const t = (key: string, subs?: string[]): string =>
  chrome.i18n.getMessage(key, subs) || key;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

// Apply translations to all data-i18n elements.
for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n as string);
}

const list = $<HTMLUListElement>("#list");
const empty = $("#empty");
const count = $("#count");
const editor = $("#editor");
const fTitle = $<HTMLInputElement>("#f-title");
const fShortcut = $<HTMLInputElement>("#f-shortcut");
const fBody = $<HTMLTextAreaElement>("#f-body");
const status = $("#status");
const deleteSelectedBtn = $<HTMLButtonElement>("#delete-selected");

const reminderList = $<HTMLUListElement>("#reminder-list");
const reminderEmpty = $("#reminder-empty");
const reminderCount = $("#reminder-count");

const proStatus = $("#pro-status");
const upgradeLink = $<HTMLAnchorElement>("#upgrade");
const licenseEntry = $("#license-entry");
const fLicense = $<HTMLInputElement>("#f-license");
const activateBtn = $<HTMLButtonElement>("#activate");
const deactivateBtn = $<HTMLButtonElement>("#deactivate");
const licenseError = $("#license-error");

const selected = new Set<string>();

let editingId: string | null = null;

function updateDeleteSelected(): void {
  deleteSelectedBtn.hidden = selected.size === 0;
  deleteSelectedBtn.textContent = t("deleteSelected", [String(selected.size)]);
}

async function render(): Promise<void> {
  const templates = await getTemplates();
  for (const id of [...selected]) if (!templates.some((t) => t.id === id)) selected.delete(id);
  // License-aware counter: Pro sees a plain count; free sees "N / 15" plus a
  // link to the Pro section. Assigning textContent first wipes any previous
  // children, so re-renders stay clean.
  const pro = await isProActive();
  if (pro) {
    count.textContent = t("templateCount", [String(templates.length)]);
  } else {
    count.textContent =
      t("templateCountCapped", [String(templates.length), String(FREE_TEMPLATE_CAP)]) + " · ";
    const a = document.createElement("a");
    a.href = "#pro";
    a.textContent = t("proRemovesLimit");
    count.appendChild(a);
  }
  empty.hidden = templates.length > 0;
  list.replaceChildren(
    ...templates.map((tpl) => {
      const li = document.createElement("li");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(tpl.id);
      check.addEventListener("change", () => {
        if (check.checked) selected.add(tpl.id);
        else selected.delete(tpl.id);
        updateDeleteSelected();
      });
      const title = document.createElement("span");
      title.className = "t-title";
      title.textContent = tpl.title;
      const shortcut = document.createElement("span");
      shortcut.className = "t-shortcut";
      shortcut.textContent = tpl.shortcut ? `/${tpl.shortcut}` : "";
      const body = document.createElement("span");
      body.className = "t-body";
      body.textContent = tpl.body;
      const edit = document.createElement("button");
      edit.className = "small edit";
      edit.textContent = t("edit");
      edit.addEventListener("click", () => openEditor(tpl));
      const del = document.createElement("button");
      del.className = "small danger";
      del.textContent = t("delete");
      del.addEventListener("click", async () => {
        if (!window.confirm(t("deleteConfirm", [tpl.title]))) return;
        try {
          await deleteTemplate(tpl.id);
        } catch (err) {
          // Spec: storage write failures must be visible in the options page.
          status.textContent = String(err);
          return;
        }
        await render();
      });
      li.append(title, shortcut, body, edit, del);
      li.prepend(check);
      return li;
    })
  );
  updateDeleteSelected();
}

async function renderReminders(): Promise<void> {
  // Show everything not dismissed (pending + already-fired), soonest first.
  const all = (await getReminders())
    .filter((r) => r.status !== "dismissed")
    .sort((a, b) => a.dueAt - b.dueAt);
  const pending = countPending(all);
  const pro = await isProActive();
  reminderCount.textContent = pro
    ? t("reminderCount", [String(pending)])
    : t("reminderCountCapped", [String(pending), String(FREE_REMINDER_CAP)]);
  reminderEmpty.hidden = all.length > 0;
  const labels = { today: t("reminderWhenToday"), tomorrow: t("reminderWhenTomorrow") };
  reminderList.replaceChildren(
    ...all.map((r) => {
      const li = document.createElement("li");
      const chat = document.createElement("span");
      chat.className = "r-chat";
      chat.textContent = r.chatName;
      const when = document.createElement("span");
      when.className = "r-when";
      when.textContent = formatDueAt(r.dueAt, Date.now(), navigator.language, labels);
      if (r.status === "fired") {
        const badge = document.createElement("span");
        badge.className = "r-due";
        badge.textContent = t("reminderDueBadge");
        when.append(" ", badge);
      }
      const note = document.createElement("span");
      note.className = "r-note";
      note.textContent = r.note;
      const del = document.createElement("button");
      del.className = "small danger";
      del.textContent = "✕";
      del.title = t("reminderCancelTitle");
      del.addEventListener("click", async () => {
        try {
          // Deleting also updates the toolbar badge/alarms: the background
          // worker reacts to the storage change.
          await deleteReminder(r.id);
        } catch (err) {
          status.textContent = String(err);
          return;
        }
        await renderReminders();
      });
      li.append(chat, when, note, del);
      return li;
    })
  );
}

function openEditor(tpl: Template | null): void {
  editingId = tpl?.id ?? null;
  fTitle.value = tpl?.title ?? "";
  fShortcut.value = tpl?.shortcut ?? "";
  fBody.value = tpl?.body ?? "";
  editor.hidden = false;
  fTitle.focus();
}

function closeEditor(): void {
  editor.hidden = true;
  editingId = null;
}

$("#add").addEventListener("click", async () => {
  // Cap blocks NEW adds only for free users at/over the limit.
  if (!(await isProActive()) && (await getTemplates()).length >= FREE_TEMPLATE_CAP) {
    status.textContent = t("templateCapReached");
    return;
  }
  openEditor(null);
});
$("#cancel").addEventListener("click", closeEditor);

$("#save").addEventListener("click", async () => {
  const title = fTitle.value.trim();
  const body = fBody.value;
  if (!title || !body.trim()) {
    status.textContent = t("validationError");
    return;
  }
  // Defense in depth: gate a NEW template save too (editor may have opened
  // before the cap was hit). Edits (editingId !== null) are NEVER blocked.
  if (
    editingId === null &&
    !(await isProActive()) &&
    (await getTemplates()).length >= FREE_TEMPLATE_CAP
  ) {
    status.textContent = t("templateCapReached");
    return;
  }
  try {
    const existing = editingId ? (await getTemplates()).find((x) => x.id === editingId) : null;
    await saveTemplate({
      id: editingId ?? crypto.randomUUID(),
      title,
      shortcut: fShortcut.value.trim().replace(/^\//, "").toLowerCase(),
      body,
      createdAt: existing?.createdAt ?? Date.now(),
      usageCount: existing?.usageCount ?? 0,
    });
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  status.textContent = "";
  closeEditor();
  await render();
});

$("#export").addEventListener("click", async () => {
  const blob = new Blob([exportToJson(await getTemplates())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "quickreply-templates.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

const importFile = $<HTMLInputElement>("#import-file");
$("#import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  const result = parseImport(await file.text());
  if (!result.ok) {
    window.alert(t("importError"));
    return;
  }
  const { accepted, skipped } = capImport(
    (await getTemplates()).length,
    result.templates,
    await isProActive()
  );
  try {
    for (const tpl of accepted) await saveTemplate(tpl);
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  status.textContent =
    skipped > 0
      ? t("importCapped", [String(accepted.length), String(skipped)])
      : t("importSuccess");
  await render();
});

deleteSelectedBtn.addEventListener("click", async () => {
  if (!window.confirm(t("deleteSelectedConfirm", [String(selected.size)]))) return;
  try {
    await deleteTemplates([...selected]);
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  selected.clear();
  await render();
});

async function renderPro(): Promise<void> {
  const state = await getLicense();
  const view = proView(state, Date.now());
  const statusText: Record<typeof view, string> = {
    free: t("proStatusFree"),
    active: t("proStatusActive", [state?.plan ?? "Pro"]),
    offline: t("proStatusOffline"),
    invalid: t("proStatusInvalid"),
  };
  proStatus.textContent = statusText[view];
  const showBuy = view === "free" || view === "invalid";
  upgradeLink.hidden = !showBuy || CHECKOUT_URL === "";
  if (!upgradeLink.hidden) {
    upgradeLink.href = CHECKOUT_URL;
    upgradeLink.textContent = t("upgradeButton", [PRICE_DISPLAY]);
  }
  licenseEntry.hidden = !showBuy;
  deactivateBtn.hidden = showBuy;
}

activateBtn.addEventListener("click", async () => {
  const key = fLicense.value.trim();
  if (key === "") return;
  // In-flight guard: a double-click must not fire two activations and
  // consume two instance seats on the provider.
  activateBtn.disabled = true;
  try {
    licenseError.textContent = "";
    const result = await activateLicense(key);
    if (!result.ok) {
      // Invalid/garbled key or network trouble: clear inline error, nothing stored.
      licenseError.textContent = t(
        result.error === "invalid-key" ? "licenseErrorInvalid" : "licenseErrorNetwork"
      );
      return;
    }
    try {
      await saveLicense(result.state);
    } catch (err) {
      status.textContent = String(err);
      return;
    }
    fLicense.value = "";
    await renderPro();
    await render(); // Task 13 makes the template counter license-aware
  } finally {
    activateBtn.disabled = false;
  }
});

deactivateBtn.addEventListener("click", async () => {
  const state = await getLicense();
  if (state) void deactivateLicense(state); // best-effort, fire and forget
  try {
    await saveLicense(null);
  } catch (err) {
    status.textContent = String(err);
    return;
  }
  await renderPro();
  await render();
});

chrome.notifications.getPermissionLevel((level) => {
  if (level === "denied") $("#notif-warning").hidden = false;
});

void render();
void renderReminders();
void renderPro();

// Reflect reminders fired/changed by the background worker while the options
// page is open (badge cleared, new fires) without needing a manual refresh.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.reminders) void renderReminders();
});
