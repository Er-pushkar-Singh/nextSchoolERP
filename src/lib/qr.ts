import QRCode from "qrcode";

/** A QR code as an SVG data URL, built without any network call (works inside print pages and templates). */
export function qrDataUrl(text: string, dark = "#000000"): string {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size;
  const d = q.modules.data;
  let path = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[y * n + x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="${dark}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Fills every QR slot (<img data-qr="code">) of a rendered document. */
export function withQr(html: string): string {
  return html.replace(/<img([^>]*?)data-qr="([0-9a-f]{12})"([^>]*?)src=""/g, (_m, a: string, code: string, b: string) => `<img${a}data-qr="${code}"${b}src="${qrDataUrl(code)}"`);
}
