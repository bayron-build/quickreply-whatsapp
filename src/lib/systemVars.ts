/**
 * System placeholders auto-filled at insertion time, like {name}.
 * Keys are deliberately unambiguous ({today}, never {date}): a template
 * saying "until {date}" means a date the seller chooses, and auto-filling
 * it would silently send a wrong message.
 */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

export function systemPlaceholders(
  now: Date,
  locale: string
): Record<string, string> {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const today = now.toLocaleDateString(locale, DATE_FORMAT);
  const tomorrowStr = tomorrow.toLocaleDateString(locale, DATE_FORMAT);
  const time = now.toLocaleTimeString(locale, TIME_FORMAT);

  return {
    today,
    time,
    tomorrow: tomorrowStr,
    // Indonesian aliases (same values) for the core market.
    hari_ini: today,
    jam: time,
    besok: tomorrowStr,
  };
}
