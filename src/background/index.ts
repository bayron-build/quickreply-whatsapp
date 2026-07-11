/**
 * Background service worker: owns chrome.alarms, notifications, and the
 * toolbar badge. Kept deliberately thin — all decisions live in the pure
 * functions of src/lib/reminders.ts. HARD RULE: never sends messages on
 * WhatsApp; notification click-through only NAVIGATES (see OpenChatMessage).
 */
import type { OpenChatMessage, Reminder } from "../lib/types";
import { OPEN_CHAT_MSG, DAY_MS } from "../lib/types";
import { dueReminders, getReminders, setReminderStatus } from "../lib/reminders";
import { applyValidation, getLicense, revalidateLicense, saveLicense } from "../lib/license";

/** Reserved for weekly license revalidation (handler ships with the license task). */
const LICENSE_ALARM = "qr-license-revalidate";
const WA_URL = "https://web.whatsapp.com/";

const t = (key: string, subs?: string[]): string => chrome.i18n.getMessage(key, subs) || key;

/** One chrome.alarms alarm per pending reminder, alarm name = reminder id. */
async function reconcileAlarms(): Promise<void> {
  const reminders = await getReminders();
  const pending = reminders.filter((r) => r.status === "pending");
  const pendingIds = new Set(pending.map((r) => r.id));
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name !== LICENSE_ALARM && !pendingIds.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const r of pending) {
    chrome.alarms.create(r.id, { when: Math.max(r.dueAt, Date.now() + 1000) });
  }
}

async function updateBadge(): Promise<void> {
  const fired = (await getReminders()).filter((r) => r.status === "fired").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#008069" });
  await chrome.action.setBadgeText({ text: fired === 0 ? "" : String(fired) });
}

async function fireReminder(r: Reminder): Promise<void> {
  await setReminderStatus(r.id, "fired");
  chrome.notifications.create(r.id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: t("reminderNotifTitle", [r.chatName]),
    message: r.note,
  });
  await updateBadge();
}

/**
 * Daily alarm, weekly work: validate only when the last success is ≥7 days
 * old, so the cadence survives browser restarts without extra bookkeeping.
 * Outcomes: valid refreshes the grace window; invalid soft-locks Pro (data
 * untouched, reminders still fire); unreachable lets the grace window run.
 */
async function revalidateIfDue(): Promise<void> {
  const state = await getLicense();
  if (!state || state.status === "invalid") return;
  if (Date.now() - state.lastValidatedAt < 7 * DAY_MS) return;
  const outcome = await revalidateLicense(state);
  await saveLicense(applyValidation(state, outcome, Date.now()));
}

/** Fire anything missed while the browser was closed, then (re)schedule the rest. */
async function sweepAndSchedule(): Promise<void> {
  const reminders = await getReminders();
  for (const r of dueReminders(reminders, Date.now())) {
    await fireReminder(r);
  }
  await reconcileAlarms();
  await updateBadge();
  chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: 24 * 60 });
  await revalidateIfDue();
}

async function openWhatsAppAt(chatName: string): Promise<void> {
  const msg: OpenChatMessage = { type: OPEN_CHAT_MSG, chatName };
  const [tab] = await chrome.tabs.query({ url: WA_URL + "*" });
  if (tab?.id != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      // Content script not ready (page mid-load). WhatsApp is focused — acceptable.
    }
    return;
  }
  const created = await chrome.tabs.create({ url: WA_URL });
  // Content script loads at document_idle; retry briefly, then give up
  // (spec: tab open and focused is the acceptable fallback).
  for (let i = 0; i < 15; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    try {
      if (created.id != null) {
        await chrome.tabs.sendMessage(created.id, msg);
        return;
      }
    } catch {
      // keep retrying
    }
  }
}

async function handleNotificationClick(id: string): Promise<void> {
  chrome.notifications.clear(id);
  const r = (await getReminders()).find((x) => x.id === id);
  if (!r) return;
  await setReminderStatus(id, "dismissed");
  await updateBadge();
  await openWhatsAppAt(r.chatName);
}

async function onAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name === LICENSE_ALARM) {
    await revalidateIfDue();
    return;
  }
  const r = (await getReminders()).find((x) => x.id === alarm.name && x.status === "pending");
  if (r) await fireReminder(r);
}

chrome.runtime.onInstalled.addListener(() => void sweepAndSchedule());
chrome.runtime.onStartup.addListener(() => void sweepAndSchedule());
chrome.alarms.onAlarm.addListener((alarm) => void onAlarm(alarm));
chrome.notifications.onClicked.addListener((id) => void handleNotificationClick(id));
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

// Creating/deleting reminders anywhere (picker, future UIs) reschedules alarms
// declaratively — no explicit messaging needed, survives worker restarts.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.reminders) void reconcileAlarms().then(updateBadge);
});

// Content scripts can't call openOptionsPage directly.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "qr-open-options") void chrome.runtime.openOptionsPage();
});
