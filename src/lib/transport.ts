import { addDays, fmtDate, todayIST } from "./format";

export type Vehicle = {
  id: string; reg_no: string; kind: string; capacity: number | null; driver_name: string | null; driver_phone: string | null; driver_licence: string | null;
  attendant_name: string | null; attendant_phone: string | null; insurance_upto: string | null; fitness_upto: string | null; permit_upto: string | null;
  puc_upto: string | null; active: boolean; notes: string | null;
};

export const VEHICLE_DOCS = [["insurance_upto", "Insurance"], ["fitness_upto", "Fitness"], ["permit_upto", "Permit"], ["puc_upto", "PUC"]] as const;

/** Vehicle papers that have expired or expire within `days`. */
export function expiringDocs(v: Vehicle, days = 30) {
  const today = todayIST(), soon = addDays(today, days);
  return VEHICLE_DOCS.flatMap(([k, name]) => {
    const d = v[k];
    if (!d || d > soon) return [];
    return [{ name, date: d, expired: d < today, text: `${name} ${d < today ? "expired" : "expires"} ${fmtDate(d)}` }];
  });
}

/** "07:10:00" → "7:10 am" */
export function fmtTime(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export const TRIPS: [string, string][] = [["both", "Pickup & drop"], ["pickup", "Pickup only"], ["drop", "Drop only"]];
