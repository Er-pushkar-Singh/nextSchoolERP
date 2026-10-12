/** Formatting helpers shared by server and client. */

export const label = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";


export function money(n: number | string | null | undefined, currency = "INR") {
  const v = Number(n ?? 0);
  if (currency === "INR") return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
}

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) {
  return n < 20 ? ones.at(n)! : `${tens.at(Math.floor(n / 10))}${n % 10 ? " " + ones.at(n % 10) : ""}`;
}
function three(n: number) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ones.at(h)} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
}
/** Indian numbering: 1,23,45,678 → "One Crore Twenty Three Lakh …" */
export function amountInWords(amount: number, currency = "INR") {
  const whole = Math.floor(amount), paise = Math.round((amount - whole) * 100);
  if (whole === 0 && paise === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(whole / 1e7), lakh = Math.floor((whole % 1e7) / 1e5), thousand = Math.floor((whole % 1e5) / 1e3), rest = whole % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  const unit = currency === "INR" ? ["Rupees", "Paise"] : [currency, "Cents"];
  return `${unit[0]} ${parts.join(" ")}${paise ? ` and ${two(paise)} ${unit[1]}` : ""} Only`;
}

export const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

export const isOverdue = (inv: { status: string; due_date: string | null }) =>
  ["sent", "partially_paid"].includes(inv.status) && !!inv.due_date && inv.due_date < todayIST();
export const hourIST = () => Number(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 13));

export const waNumber = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
};
export const waLink = (phone: string | null | undefined, text: string) =>
  phone ? `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}` : null;
export const fullName = (s: { first_name: string; last_name?: string | null }) => [s.first_name, s.last_name].filter(Boolean).join(" ");
export const cleanSearch = (q: string) => q.replace(/[%,()*]/g, "").slice(0, 60);
