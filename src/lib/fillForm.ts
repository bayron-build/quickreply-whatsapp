import { extractPlaceholders } from "./template";

export interface FillField {
  key: string;
  /** Pre-filled value for auto placeholders; "" for ones the user must type. */
  value: string;
  /** True when the system can fill it ({name}, {today}, …) — shown greyed, overridable. */
  auto: boolean;
}

export function buildFillFields(body: string, autoVars: Record<string, string>): FillField[] {
  return extractPlaceholders(body).map((key) => {
    const auto = key in autoVars;
    return { key, value: auto ? autoVars[key] : "", auto };
  });
}

export function needsFillForm(fields: FillField[]): boolean {
  return fields.some((f) => !f.auto);
}
