export interface Template {
  id: string;
  title: string;
  shortcut: string;
  body: string;
  createdAt: number;
  usageCount: number;
}

export interface Settings {
  hotkey: string;
  language: "en" | "id" | "auto";
}

export const SCHEMA_VERSION = 1;

/** Free-tier cap. Displayed as a counter in v1; NOT enforced until Pro exists (see spec, Monetization). */
export const FREE_TEMPLATE_CAP = 15;

export const DEFAULT_SETTINGS: Settings = { hotkey: "Ctrl+/", language: "auto" };
