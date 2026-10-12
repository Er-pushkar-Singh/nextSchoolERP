/* Integration catalogue: what each provider needs. Shared by the school and the platform settings screens.
   `secret: true` fields are encrypted (src/lib/crypto.ts) and never sent back to the browser. */

export type Provider = "razorpay" | "cloudinary" | "email" | "sms" | "whatsapp";
export type Field = {
  name: string; label: string; secret?: boolean; required?: boolean; type?: "text" | "number" | "email" | "select" | "checkbox";
  options?: [string, string][]; placeholder?: string; hint?: string; platformOnly?: boolean; schoolOnly?: boolean; when?: [string, string]; wide?: boolean;
};
export type ProviderDef = {
  code: Provider; name: string; tagline: string; icon: "card" | "backups" | "notifications" | "tickets" | "support"; docs: string;
  fields: Field[]; testSend?: "email" | "mobile";
  schoolUse: string; platformUse: string;
};

export const SMS_EVENTS: [string, string][] = [
  ["fee_receipt", "Fee receipt"], ["fee_reminder", "Fee reminder"], ["absent", "Absent alert"], ["exam_result", "Result published"],
  ["notice", "New notice"], ["otp", "Login OTP"],
];

export const PROVIDERS: ProviderDef[] = [
  {
    code: "razorpay", name: "Razorpay", tagline: "Online payments — UPI, cards, net banking", icon: "card", docs: "https://razorpay.com/docs/api/authentication/",
    schoolUse: "Parents pay fees online into the school's own Razorpay account; paid links close the dues automatically.",
    platformUse: "Schools pay their subscription invoices through CodersDuniya's Razorpay account.",
    fields: [
      { name: "mode", label: "Mode", type: "select", options: [["test", "Test mode"], ["live", "Live mode"]], required: true },
      { name: "key_id", label: "Key ID", required: true, placeholder: "rzp_test_… / rzp_live_…" },
      { name: "key_secret", label: "Key secret", secret: true, required: true },
      { name: "webhook_secret", label: "Webhook secret", secret: true, hint: "Razorpay → Settings → Webhooks. URL: /api/razorpay/webhook, event payment_link.paid." },
    ],
  },
  {
    code: "cloudinary", name: "Cloudinary", tagline: "Photos, logos, documents and backups storage", icon: "backups", docs: "https://cloudinary.com/documentation/how_to_integrate_cloudinary",
    schoolUse: "School logo, student photos and documents are stored in this Cloudinary account.",
    platformUse: "Default storage for every school without its own account, and the place nightly backups go.",
    fields: [
      { name: "cloud_name", label: "Cloud name", required: true, placeholder: "e.g. dx1abcde" },
      { name: "api_key", label: "API key", required: true },
      { name: "api_secret", label: "API secret", secret: true, required: true },
      { name: "folder", label: "Folder", placeholder: "school-erp", hint: "Everything is stored under this folder." },
      { name: "share_with_schools", label: "Let schools without their own account use this one", type: "checkbox", platformOnly: true, wide: true },
    ],
  },
  {
    code: "email", name: "Email", tagline: "Receipts, reminders and login emails", icon: "notifications", docs: "https://resend.com/docs/api-reference/introduction", testSend: "email",
    schoolUse: "Emails to parents and staff are sent from your school's address.",
    platformUse: "Invoices, welcome mails and password resets from CodersDuniya; default for schools when shared.",
    fields: [
      { name: "transport", label: "Send through", type: "select", options: [["smtp", "SMTP (Gmail, Zoho, Outlook, Amazon SES, Brevo…)"], ["resend", "Resend API"]], required: true, wide: true },
      { name: "from_name", label: "From name", required: true, placeholder: "Sunrise Public School" },
      { name: "from_email", label: "From email", type: "email", required: true, placeholder: "office@school.in" },
      { name: "reply_to", label: "Reply-to (optional)", type: "email" },
      { name: "smtp_host", label: "SMTP host", required: true, placeholder: "smtp.gmail.com", when: ["transport", "smtp"] },
      { name: "smtp_port", label: "SMTP port", type: "number", placeholder: "587", when: ["transport", "smtp"] },
      { name: "smtp_security", label: "Security", type: "select", options: [["starttls", "STARTTLS (port 587)"], ["ssl", "SSL/TLS (port 465)"]], when: ["transport", "smtp"] },
      { name: "smtp_user", label: "SMTP username", required: true, when: ["transport", "smtp"] },
      { name: "smtp_password", label: "SMTP password / app password", secret: true, required: true, when: ["transport", "smtp"] },
      { name: "resend_api_key", label: "Resend API key", secret: true, required: true, when: ["transport", "resend"], placeholder: "re_…" },
      { name: "share_with_schools", label: "Let schools without their own email use this one", type: "checkbox", platformOnly: true, wide: true },
    ],
  },
  {
    code: "sms", name: "SMS (MSG91)", tagline: "DLT-approved SMS to parents in India", icon: "tickets", docs: "https://docs.msg91.com/sms", testSend: "mobile",
    schoolUse: "Absent alerts, fee receipts and reminders by SMS from your own sender ID.",
    platformUse: "Shared SMS account for schools that don't have their own DLT registration.",
    fields: [
      { name: "auth_key", label: "MSG91 auth key", secret: true, required: true },
      { name: "sender_id", label: "Sender ID (DLT header)", required: true, placeholder: "SCHOOL", hint: "6 letters, approved on the DLT portal." },
      { name: "dlt_entity_id", label: "DLT principal entity ID", placeholder: "1201…" },
      ...SMS_EVENTS.map(([k, l]): Field => ({ name: `tpl_${k}`, label: `${l} — flow template ID`, placeholder: "MSG91 flow / template ID" })),
      { name: "share_with_schools", label: "Let schools without their own SMS account use this one", type: "checkbox", platformOnly: true, wide: true },
    ],
  },
  {
    code: "whatsapp", name: "WhatsApp Cloud API", tagline: "Automatic WhatsApp messages (Meta)", icon: "support", docs: "https://developers.facebook.com/docs/whatsapp/cloud-api", testSend: "mobile",
    schoolUse: "Send receipts and alerts on WhatsApp automatically instead of tapping wa.me links.",
    platformUse: "Shared WhatsApp number for schools without their own.",
    fields: [
      { name: "phone_number_id", label: "Phone number ID", required: true },
      { name: "waba_id", label: "WhatsApp Business account ID" },
      { name: "access_token", label: "Permanent access token", secret: true, required: true, wide: true },
      { name: "api_version", label: "Graph API version", placeholder: "v23.0" },
      { name: "test_template", label: "Approved template for the test message", placeholder: "hello_world" },
      { name: "share_with_schools", label: "Let schools without their own number use this one", type: "checkbox", platformOnly: true, wide: true },
    ],
  },
];

export const providerDef = (code: string) => PROVIDERS.find((p) => p.code === code);
