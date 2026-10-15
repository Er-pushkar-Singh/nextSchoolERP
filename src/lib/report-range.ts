import { addDays } from "@/lib/format";

export type Range = { d1: string; d2: string; preset: string; params: Record<string, string | undefined> };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Reads ?p=today|7|30|month|session or ?from=&to= (never later than today); default is the current month. */
export function reportRange(sp: { p?: string; from?: string; to?: string }, today: string, sessionStart?: string | null): Range {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (ISO.test(sp.from ?? "") || ISO.test(sp.to ?? "")) {
    let d2 = ISO.test(sp.to ?? "") ? sp.to! : today;
    if (d2 > today) d2 = today;
    let d1 = ISO.test(sp.from ?? "") ? sp.from! : addDays(d2, -29);
    if (d1 > d2) d1 = d2;
    if (d1 < addDays(d2, -800)) d1 = addDays(d2, -800);
    return { d1, d2, preset: "custom", params: { from: d1, to: d2 } };
  }
  switch (sp.p) {
    case "today": return { d1: today, d2: today, preset: "today", params: { p: "today" } };
    case "7": return { d1: addDays(today, -6), d2: today, preset: "7", params: { p: "7" } };
    case "30": return { d1: addDays(today, -29), d2: today, preset: "30", params: { p: "30" } };
    case "session": return { d1: sessionStart && sessionStart <= today ? sessionStart : monthStart, d2: today, preset: "session", params: { p: "session" } };
    default: return { d1: monthStart, d2: today, preset: "month", params: {} };
  }
}

export const PRESETS: [string, string][] = [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["month", "This month"], ["session", "This session"]];
