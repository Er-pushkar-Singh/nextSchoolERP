/** Shared fee constants. */

/**
 * How money is received at the desk. `value` is what the form posts; `mode` / `sub` are what the database stores.
 * Groups: Cash · Card · Others · (Payment gateway / payment link are separate, see the collect screen).
 */
export const METHODS: { value: string; label: string; group: string; mode: string; sub?: string; refLabel: string }[] = [
  { value: "cash", label: "Cash", group: "Cash", mode: "cash", refLabel: "Note (optional)" },
  { value: "debit_card", label: "Debit card", group: "Card", mode: "card", sub: "debit", refLabel: "POS slip / last 4 digits" },
  { value: "credit_card", label: "Credit card", group: "Card", mode: "card", sub: "credit", refLabel: "POS slip / last 4 digits" },
  { value: "upi", label: "UPI / QR", group: "Others", mode: "upi", refLabel: "UTR / transaction id" },
  { value: "cheque", label: "Cheque", group: "Others", mode: "cheque", refLabel: "Cheque no." },
  { value: "bank_transfer", label: "Bank transfer (NEFT / RTGS / IMPS)", group: "Others", mode: "bank_transfer", refLabel: "UTR / reference" },
  { value: "dd", label: "Demand draft", group: "Others", mode: "dd", refLabel: "DD no." },
  { value: "other", label: "Other (scholarship, adjustment…)", group: "Others", mode: "other", sub: "Other", refLabel: "Reference / what it is" },
];
export const METHOD_GROUPS = ["Cash", "Card", "Others"];
export const methodOf = (v: string) => METHODS.find((m) => m.value === v) ?? METHODS[0];

/** Kept for older screens (modes as stored). */
export const PAY_MODES: [string, string][] = [["cash", "Cash"], ["card", "Card"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["dd", "Demand draft"], ["other", "Other"], ["online", "Online"]];

export const CONCESSION_CATEGORIES: [string, string][] = [
  ["rte", "RTE / government"], ["staff_ward", "Staff ward"], ["sibling", "Sibling"], ["merit", "Merit / scholarship"],
  ["sports", "Sports / activity"], ["hardship", "Hardship"], ["other", "Other"],
];

export const FINE_MODES: [string, string][] = [["per_day", "Per day late"], ["per_month", "Per month (or part) late"], ["flat", "One flat amount"]];

export const MODE_LABEL: Record<string, string> = {
  cash: "Cash", upi: "UPI / QR", cheque: "Cheque", bank_transfer: "Bank transfer", card: "Card", dd: "Demand draft", other: "Other", online: "Payment gateway / link",
  mixed: "Split payment", wallet: "Advance / wallet",
};

export const LINK_STATUS: Record<string, string> = { created: "Waiting for payment", paid: "Paid", failed: "Failed", expired: "Expired", cancelled: "Cancelled" };
