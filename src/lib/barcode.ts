/* Code 128 barcodes as SVG — no library, no network. Used on ID cards and attendance cards; any USB / Bluetooth barcode
   scanner (a "keyboard wedge") reads them and types the code into the scan station. */

// bar/space widths of the 106 symbols (0–105) and the stop pattern, from the Code 128 specification
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232",
];
const STOP = "2331112";
export const CODE128 = { PATTERNS, STOP };

/** Symbol values (start, data, checksum) for a text. Digits-only text of even length uses the denser set C. */
export function code128Values(text: string): number[] {
  const t = String(text ?? "");
  let vals: number[];
  if (/^\d+$/.test(t) && t.length >= 4 && t.length % 2 === 0) {
    vals = [105];
    for (let i = 0; i < t.length; i += 2) vals.push(Number(t.slice(i, i + 2)));
  } else {
    vals = [104];
    for (const ch of t) {
      const c = ch.charCodeAt(0);
      vals.push(c >= 32 && c <= 126 ? c - 32 : 31); // anything else becomes "?"
    }
  }
  const sum = vals.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  vals.push(sum % 103);
  return vals;
}

/** The module widths (bar, space, bar …) of the whole symbol including the stop pattern. */
export function code128Modules(text: string): number[] {
  return code128Values(text).map((v) => PATTERNS[v]).concat(STOP).join("").split("").map(Number);
}

/** An SVG string. `height` in modules; a quiet zone of 10 modules on each side. */
export function code128Svg(text: string, height = 40): string {
  const mods = code128Modules(text);
  const total = mods.reduce((s, m) => s + m, 0) + 20;
  let x = 10, path = "";
  mods.forEach((w, i) => { if (i % 2 === 0) path += `M${x} 0h${w}v${height}h-${w}z`; x += w; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const b64 = (s: string) => (typeof Buffer !== "undefined" ? Buffer.from(s).toString("base64") : btoa(s));
export const barcodeDataUrl = (text: string, height = 40) => `data:image/svg+xml;base64,${b64(code128Svg(text, height))}`;

/** Fills every barcode slot (<img data-barcode="code" src="">) of a rendered document. */
export function withBarcode(html: string): string {
  return html.replace(/<img([^>]*?)data-barcode="([0-9A-Za-z-]{1,40})"([^>]*?)src=""/g, (_m, a: string, code: string, b: string) => `<img${a}data-barcode="${code}"${b}src="${barcodeDataUrl(code)}"`);
}
