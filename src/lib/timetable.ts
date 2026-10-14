export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Period = { id: string; no: number; name: string; start_time: string; end_time: string; is_break: boolean };
export const hhmm = (t: string) => String(t).slice(0, 5);
export const workingDays = (prefs: { working_days?: number[] } | null | undefined) => {
  const d = (prefs?.working_days ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return d.length ? [...new Set(d)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6];
};
export const EVENT_KINDS: [string, string, string][] = [
  ["holiday", "Holiday", "#dc2626"], ["vacation", "Vacation", "#b45309"], ["exam", "Exam", "#7c3aed"], ["ptm", "Parent–teacher meeting", "#0891b2"], ["event", "Event", "#2563eb"], ["other", "Other", "#64748b"],
];
