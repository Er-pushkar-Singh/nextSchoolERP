import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRazorpayLink, platformRazorpay } from "./razorpay";
import { appUrl } from "./brand";

export type SubState = "trial" | "ok" | "grace" | "expired" | "pending" | "suspended";
export type Plan = {
  id: string; code: string; name: string; description: string | null; price_type: "per_student" | "flat";
  price_monthly: number; price_yearly: number; min_students: number; student_limit: number; storage_mb: number;
  trial_days: number; modules: string[]; is_public: boolean; active: boolean; sort: number;
};
export type Subscription = {
  id: string; school_id: string; plan_id: string; billing_cycle: "monthly" | "yearly"; status: string;
  current_period_start: string; current_period_end: string; grace_days: number; auto_renew: boolean; notes: string | null;
  plans: Plan | null;
};
export type SubInvoice = {
  id: string; school_id: string; number: string; plan_code: string; billing_cycle: string; period_start: string; period_end: string;
  students: number; rate: number; amount: number; gst_rate: number; gst_amount: number; total: number; status: string; due_date: string;
  paid_at: string | null; payment_ref: string | null; razorpay_link_url: string | null; created_at: string;
};

export const STATE_LABEL: Record<SubState, string> = {
  trial: "Free trial", ok: "Active", grace: "Renewal due", expired: "Expired — read-only", pending: "Awaiting approval", suspended: "Suspended",
};

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export async function getSubscription(supabase: SupabaseClient, sid: string) {
  const [{ data: sub }, { data: state }] = await Promise.all([
    supabase.from("school_subscriptions").select("*, plans(*)").eq("school_id", sid).maybeSingle(),
    supabase.rpc("subscription_state", { sid }),
  ]);
  return { sub: sub as Subscription | null, state: (state ?? "ok") as SubState };
}

/** Price text for a plan, e.g. "₹99 / student / year". */
export function priceText(p: Pick<Plan, "price_type" | "price_monthly" | "price_yearly" | "trial_days">, cycle: "monthly" | "yearly") {
  if (p.trial_days > 0) return `Free for ${p.trial_days} days`;
  const v = cycle === "yearly" ? p.price_yearly : p.price_monthly;
  const n = `₹${Number(v).toLocaleString("en-IN")}`;
  return p.price_type === "per_student" ? `${n} / student / ${cycle === "yearly" ? "year" : "month"}` : `${n} / ${cycle === "yearly" ? "year" : "month"}`;
}

/** Create a Razorpay payment link for an unpaid subscription invoice (no-op when Razorpay isn't configured). */
export async function attachPaymentLink(db: SupabaseClient, invoiceId: string) {
  const creds = await platformRazorpay();
  if (!creds) return { skipped: "Razorpay keys are not set" } as const;
  const { data: inv } = await db.from("subscription_invoices").select("id,number,total,status,razorpay_link_url,period_start,period_end,schools(name,email,phone)").eq("id", invoiceId).single();
  if (!inv || inv.status !== "due") return { skipped: "Invoice not due" } as const;
  if (inv.razorpay_link_url) return { url: inv.razorpay_link_url } as const;
  const school = inv.schools as unknown as { name: string; email: string | null; phone: string | null } | null;
  const link = await createRazorpayLink(creds, {
    amountInr: Number(inv.total), currency: "INR",
    description: `School ERP subscription ${inv.number} (${inv.period_start} to ${inv.period_end})`,
    referenceId: inv.number, customer: { name: school?.name ?? "School", email: school?.email, contact: school?.phone },
    callbackUrl: appUrl("/app/settings/billing?paid=1"),
  });
  await db.from("subscription_invoices").update({ razorpay_link_id: link.id, razorpay_link_url: link.url }).eq("id", invoiceId);
  return { url: link.url } as const;
}
