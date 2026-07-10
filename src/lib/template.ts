const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    seen.add(match[1]);
  }
  return [...seen];
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = vars[key];
    return value ? value : whole;
  });
}
