import type { Template } from "./types";

function score(t: Template, query: string): number {
  const shortcut = t.shortcut.toLowerCase();
  const title = t.title.toLowerCase();
  if (shortcut !== "" && shortcut === query) return 4;
  if (shortcut !== "" && shortcut.startsWith(query)) return 3;
  if (title.startsWith(query)) return 2;
  if (title.includes(query) || (shortcut !== "" && shortcut.includes(query))) return 1;
  return 0;
}

function byUsageThenTitle(a: Template, b: Template): number {
  return b.usageCount - a.usageCount || a.title.localeCompare(b.title);
}

export function rankTemplates(templates: Template[], query: string): Template[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...templates].sort(byUsageThenTitle);
  return templates
    .map((t) => ({ t, s: score(t, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || byUsageThenTitle(a.t, b.t))
    .map((x) => x.t);
}
