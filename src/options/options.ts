import type { Template } from "../lib/types";
import { FREE_TEMPLATE_CAP } from "../lib/types";
import { getTemplates, saveTemplate, deleteTemplate } from "../lib/storage";
import { exportToJson, parseImport } from "../lib/importExport";

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

let editingId: string | null = null;

async function render(): Promise<void> {
  const templates = await getTemplates();
  count.textContent = `${t("templateCount", [String(templates.length)])} · ${templates.length}/${FREE_TEMPLATE_CAP}`;
  empty.hidden = templates.length > 0;
  list.replaceChildren(
    ...templates.map((tpl) => {
      const li = document.createElement("li");
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
      edit.className = "small";
      edit.textContent = t("edit");
      edit.addEventListener("click", () => openEditor(tpl));
      const del = document.createElement("button");
      del.className = "small";
      del.textContent = t("delete");
      del.addEventListener("click", async () => {
        await deleteTemplate(tpl.id);
        await render();
      });
      li.append(title, shortcut, body, edit, del);
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
    status.textContent = t("importError");
    return;
  }
  for (const tpl of result.templates) await saveTemplate(tpl);
  status.textContent = t("importSuccess");
  await render();
});

void render();
