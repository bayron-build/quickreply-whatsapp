import type { Template, Settings } from "./types";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./types";

export async function read<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  const value = result[key] as T | undefined;
  return value === undefined ? fallback : value;
}

export async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value, schemaVersion: SCHEMA_VERSION });
}

export async function getTemplates(): Promise<Template[]> {
  return read<Template[]>("templates", []);
}

async function setTemplates(templates: Template[]): Promise<void> {
  await write("templates", templates);
}

export async function saveTemplate(t: Template): Promise<void> {
  const all = await getTemplates();
  const i = all.findIndex((x) => x.id === t.id);
  if (i === -1) all.push(t);
  else all[i] = t;
  await setTemplates(all);
}

export async function deleteTemplate(id: string): Promise<void> {
  await setTemplates((await getTemplates()).filter((t) => t.id !== id));
}

export async function deleteTemplates(ids: string[]): Promise<void> {
  const doomed = new Set(ids);
  await setTemplates((await getTemplates()).filter((t) => !doomed.has(t.id)));
}

export async function incrementUsage(id: string): Promise<void> {
  const all = await getTemplates();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  t.usageCount += 1;
  await setTemplates(all);
}

export async function getSettings(): Promise<Settings> {
  return read<Settings>("settings", DEFAULT_SETTINGS);
}

export async function saveSettings(s: Settings): Promise<void> {
  await write("settings", s);
}
