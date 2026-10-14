import { addDays, todayIST } from "@/lib/format";

/** ?from=&to= → a valid period (default: this month so far). */
export function period(sp: { from?: string; to?: string }) {
  const today = todayIST();
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const to = ok(sp.to) ?? today;
  const from = ok(sp.from) ?? `${today.slice(0, 8)}01`;
  return from <= to ? { from, to, today } : { from: to, to: from, today };
}

export const MODES: [string, string][] = [["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["other", "Other"]];
export const SOURCE_LABEL: Record<string, string> = { voucher: "Voucher", fee: "Fee receipt", refund: "Fee refund", payroll: "Payroll" };
export const sourceHref = (source: string, id: string | null) =>
  source === "fee" && id ? `/app/fees/receipts/${id}` : source === "refund" ? "/app/fees/refunds" : source === "payroll" ? "/app/hr/payroll" : null;
export { addDays };
