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

export const SCHEMA_VERSION = 2; // v2 adds the "reminders" key (migration: read fallback = [])

/** Free-tier cap. Enforced from v1.1: blocks NEW adds/imports only; existing templates are never touched. */
export const FREE_TEMPLATE_CAP = 15;

export const DEFAULT_SETTINGS: Settings = { hotkey: "Ctrl+/", language: "auto" };

export type ReminderStatus = "pending" | "fired" | "dismissed";

export interface Reminder {
  id: string;          // uuid; doubles as the chrome.alarms alarm name
  chatName: string;    // adapter's getChatName() at creation time
  note: string;        // optional, may be ""
  dueAt: number;       // epoch ms
  createdAt: number;
  status: ReminderStatus;
}

/** Free-tier cap on PENDING reminders. Firing is never gated. */
export const FREE_REMINDER_CAP = 2;

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Pro stays active up to this long past lastValidatedAt when validation is unreachable. */
export const LICENSE_GRACE_MS = 14 * DAY_MS;

export interface LicenseState {
  key: string;
  instanceId: string;   // Lemon Squeezy instance id from activation
  plan: string;         // display name, e.g. variant name from the provider
  status: "active" | "invalid";
  lastValidatedAt: number; // epoch ms of last successful validation
}

/** Message from background → content script: navigate to a chat (never send). */
export const OPEN_CHAT_MSG = "qr-open-chat";
export interface OpenChatMessage {
  type: typeof OPEN_CHAT_MSG;
  chatName: string;
}
