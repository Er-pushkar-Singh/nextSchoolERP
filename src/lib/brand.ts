/** Product branding — change once here. */
export const brand = {
  product: process.env.NEXT_PUBLIC_PRODUCT_NAME || "CodersDuniya School ERP",
  vendor: "CodersDuniya",
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "",
  supportWhatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3200").replace(/\/$/, ""),
};
export const appUrl = (p: string) => `${brand.appUrl}${p}`;
