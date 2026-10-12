"use server";

import { redirect } from "next/navigation";
import { portalStudent } from "@/lib/portal";
import { resolveIntegration } from "@/lib/integrations";
import { createRazorpayLink } from "@/lib/razorpay";
import { appUrl } from "@/lib/brand";

/**
 * Parent taps "Pay online": we create an order (server checks the amount against what is due),
 * make a Razorpay payment link on the SCHOOL's own account and send the parent there.
 * The receipt is created by the webhook (/api/razorpay/fees) when Razorpay confirms.
 */
export async function startOnlinePayment(f: FormData) {
  const token = String(f.get("token") ?? "");
  const back = (q: string): never => redirect(`/p/${token}?${q}`);
  const { db, s } = await portalStudent(token);
  const amount = Math.round(Number(f.get("amount")) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) back("pay_error=" + encodeURIComponent("Enter the amount to pay."));
  if (s.status !== "active") back("pay_error=" + encodeURIComponent("Online payment is available for current students only."));

  const rz = await resolveIntegration(s.school_id, "razorpay");
  if (!rz || rz.source !== "school" || !rz.config.key_id || !rz.secrets.key_secret) back("pay_error=" + encodeURIComponent("Online payment is not available. Please pay at the school office or by UPI."));

  const { data: oid, error } = await db.rpc("create_online_order", { sid: s.school_id, stu: s.id, p_amount: amount, p_due_ids: null });
  if (error || !oid) back("pay_error=" + encodeURIComponent((error?.message ?? "Could not start the payment.").slice(0, 160)));

  let url: string;
  try {
    const link = await createRazorpayLink({ keyId: rz!.config.key_id, keySecret: rz!.secrets.key_secret }, {
      amountInr: amount, currency: "INR",
      description: `School fee · ${s.first_name} ${s.last_name ?? ""} · Adm. ${s.admission_no}`.trim(),
      referenceId: String(oid),
      customer: { name: [s.first_name, s.last_name].filter(Boolean).join(" ") },
      callbackUrl: appUrl(`/p/${token}?paid=1`),
      expireBy: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
    });
    await db.from("fee_online_orders").update({ link_id: link.id, link_url: link.url }).eq("id", oid as string);
    url = link.url;
  } catch (e) {
    await db.from("fee_online_orders").update({ status: "failed", error: String((e as Error).message).slice(0, 300) }).eq("id", oid as string);
    return back("pay_error=" + encodeURIComponent("The payment page could not be opened. Please try again, or pay at the school."));
  }
  redirect(url);
}
