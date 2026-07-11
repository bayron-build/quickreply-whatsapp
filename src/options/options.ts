import type { Template } from "../lib/types";
import { getTemplates, saveTemplate, deleteTemplate, deleteTemplates } from "../lib/storage";
import { exportToJson, parseImport } from "../lib/importExport";
import { proView, activateLicense, deactivateLicense, getLicense, saveLicense } from "../lib/license";
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

const proStatus = $("#pro-status");
const upgradeLink = $<HTMLAnchorElement>("#upgrade");
const licenseEntry = $("#license-entry");
const fLicense = $<HTMLInputElement>("#f-license");
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
  // Plain count in v1 — the /cap display returns in v1.1 when the cap is enforced.
  count.textContent = t("templateCount", [String(templates.length)]);
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

$("#add").addEventListener("click", () => openEditor(null));
$("#cancel").addEventListener("click", closeEditor);

$("#save").addEventListener("click", async () => {
  const title = fTitle.value.trim();
  const body = fBody.value;
  if (!title || !body.trim()) {
    status.textContent = t("validationError");
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
  try {
    for (const tpl of result.templates) await saveTemplate(tpl);
  } catch (err) {
    // Spec: storage write failures must be visible in the options page.
    status.textContent = String(err);
    return;
  }
  status.textContent = t("importSuccess");
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

$("#activate").addEventListener("click", async () => {
  const key = fLicense.value.trim();
  if (key === "") return;
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
void renderPro();
