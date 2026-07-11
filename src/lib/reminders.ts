import type { Reminder, ReminderStatus } from "./types";
import { FREE_REMINDER_CAP } from "./types";
import { read, write } from "./storage";

export type ReminderPreset = "1h" | "3h" | "tomorrow9";

export function presetDueAt(preset: ReminderPreset, now: Date): number {
  if (preset === "1h") return now.getTime() + 3_600_000;
  if (preset === "3h") return now.getTime() + 3 * 3_600_000;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/**
 * Human label for a reminder's due time, e.g. "today 15:30", "tomorrow 09:00",
 * or "20 Jul 09:00". The today/tomorrow words are passed in so this stays pure
 * and locale-agnostic (the options page supplies the translated labels).
 */
export function formatDueAt(
  dueAt: number,
  now: number,
  locale: string,
  labels: { today: string; tomorrow: string }
): string {
  const due = new Date(dueAt);
  const time = due.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(due, today)) return `${labels.today} ${time}`;
  if (sameDay(due, tomorrow)) return `${labels.tomorrow} ${time}`;
  return `${due.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

export function countPending(reminders: Reminder[]): number {
  return reminders.filter((r) => r.status === "pending").length;
}

/** Firing is never gated — this caps CREATION only. */
export function canAddReminder(reminders: Reminder[], pro: boolean): boolean {
  return pro || countPending(reminders) < FREE_REMINDER_CAP;
}

export function dueReminders(reminders: Reminder[], now: number): Reminder[] {
  return reminders.filter((r) => r.status === "pending" && r.dueAt <= now);
}

export async function getReminders(): Promise<Reminder[]> {
  return read<Reminder[]>("reminders", []);
}

async function setReminders(reminders: Reminder[]): Promise<void> {
  await write("reminders", reminders);
}

export async function saveReminder(r: Reminder): Promise<void> {
  const all = await getReminders();
  const i = all.findIndex((x) => x.id === r.id);
  if (i === -1) all.push(r);
  else all[i] = r;
  await setReminders(all);
}

export async function setReminderStatus(id: string, status: ReminderStatus): Promise<void> {
  const all = await getReminders();
  const r = all.find((x) => x.id === id);
  if (!r) return;
  r.status = status;
  await setReminders(all);
}

export async function deleteReminder(id: string): Promise<void> {
  await setReminders((await getReminders()).filter((r) => r.id !== id));
}
