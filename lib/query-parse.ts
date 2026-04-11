import { normalizeState } from "@/lib/usa-states";
import { resolveSection, type UstaSection } from "@/lib/usta-sections";

export type ParsedEventQuery =
  | { kind: "date"; date: string }
  | { kind: "state"; code: string }
  | { kind: "section"; section: UstaSection }
  | { kind: "text"; value: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseDate(input: string): string | null {
  const iso = ISO_DATE.exec(input);
  if (iso) {
    const [, y, m, d] = iso;
    return isValidDate(+y, +m, +d) ? `${y}-${m}-${d}` : null;
  }
  const us = US_DATE.exec(input);
  if (us) {
    const [, m, d, y] = us;
    const mm = m.padStart(2, "0");
    const dd = d.padStart(2, "0");
    return isValidDate(+y, +m, +d) ? `${y}-${mm}-${dd}` : null;
  }
  return null;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseEventQuery(q: string): ParsedEventQuery {
  const trimmed = q.trim();

  const date = parseDate(trimmed);
  if (date) return { kind: "date", date };

  const section = resolveSection(trimmed);
  if (section) return { kind: "section", section };

  const state = normalizeState(trimmed);
  if (state) return { kind: "state", code: state };

  return { kind: "text", value: trimmed };
}
