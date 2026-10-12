/** Shared fee constants. */
export const PAY_MODES: [string, string][] = [["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["online", "Online"]];

export const CONCESSION_CATEGORIES: [string, string][] = [
  ["rte", "RTE / government"], ["staff_ward", "Staff ward"], ["sibling", "Sibling"], ["merit", "Merit / scholarship"],
  ["sports", "Sports / activity"], ["hardship", "Hardship"], ["other", "Other"],
];

export const FINE_MODES: [string, string][] = [["per_day", "Per day late"], ["per_month", "Per month (or part) late"], ["flat", "One flat amount"]];

export const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", cheque: "Cheque", bank_transfer: "Bank transfer", card: "Card", online: "Online", mixed: "Split payment", wallet: "Advance / wallet" };
