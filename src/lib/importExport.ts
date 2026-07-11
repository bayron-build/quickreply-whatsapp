import type { Template } from "./types";
import { SCHEMA_VERSION, FREE_TEMPLATE_CAP } from "./types";

export type ImportResult =
  | { ok: true; templates: Template[] }
  | { ok: false; error: "invalid-json" | "invalid-format" | "invalid-template" };

export function exportToJson(templates: Template[]): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, templates }, null, 2);
}

export function parseImport(json: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "invalid-format" };
  const raw = (data as { templates?: unknown }).templates;
  if (!Array.isArray(raw)) return { ok: false, error: "invalid-format" };

  const templates: Template[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "invalid-template" };
    const r = item as Record<string, unknown>;
    if (
      typeof r.title !== "string" ||
      typeof r.shortcut !== "string" ||
      typeof r.body !== "string"
    ) {
      return { ok: false, error: "invalid-template" };
    }
    templates.push({
      id: crypto.randomUUID(),
      title: r.title,
      shortcut: r.shortcut,
      body: r.body,
      createdAt: Date.now(),
      usageCount: typeof r.usageCount === "number" ? r.usageCount : 0,
    });
  }
  return { ok: true, templates };
}

/** Free-tier import semantics: fill remaining slots in order, skip the rest.
 *  Never touches existing templates. */
export function capImport(
  existingCount: number,
  incoming: Template[],
  pro: boolean
): { accepted: Template[]; skipped: number } {
  if (pro) return { accepted: incoming, skipped: 0 };
  const room = Math.max(0, FREE_TEMPLATE_CAP - existingCount);
  return { accepted: incoming.slice(0, room), skipped: Math.max(0, incoming.length - room) };
}
