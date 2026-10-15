/** Allow-list HTML sanitiser for document templates (defence in depth: the database also strips scripts on save,
 *  and values are HTML-escaped when a document is rendered). Anything not listed is dropped. */

const TAGS = new Set(["div", "span", "p", "br", "hr", "b", "strong", "i", "em", "u", "small", "sub", "sup", "center", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "img", "blockquote", "pre", "font"]);
const ATTRS = new Set(["style", "class", "colspan", "rowspan", "width", "height", "align", "valign", "src", "alt", "data-photo", "data-qr", "data-brand", "data-barcode", "data-verify", "border", "cellpadding", "cellspacing", "size", "color"]);
const VOID = new Set(["br", "hr", "img"]);

function cleanStyle(v: string) {
  if (/expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:|-moz-binding/i.test(v)) return null;
  if (/url\s*\(/i.test(v) && !/url\s*\(\s*["']?(https:|data:image\/)/i.test(v)) return null;
  return v;
}

export function sanitizeHtml(html: string): string {
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->|<[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const stack: string[] = [];
  while ((m = re.exec(html))) {
    out.push(html.slice(last, m.index));
    last = re.lastIndex;
    const [, close, tagRaw, attrsRaw] = m;
    if (!tagRaw) continue; // comment or malformed tag: dropped
    const tag = tagRaw.toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (close) {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) { stack.splice(i); out.push(`</${tag}>`); }
      continue;
    }
    const attrs: string[] = [];
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(attrsRaw ?? ""))) {
      const name = a[1].toLowerCase();
      let val = a[2] ?? a[3] ?? a[4] ?? "";
      if (!ATTRS.has(name)) continue;
      if (name === "src" && !(val === "" || /^https:\/\//i.test(val) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(val))) continue;
      if (name === "style") { const s = cleanStyle(val); if (s === null) continue; val = s; }
      attrs.push(`${name}="${val.replace(/"/g, "&quot;")}"`);
    }
    out.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  out.push(html.slice(last));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("");
}

/** Fills the photograph slot of a rendered document with a (short-lived) image URL. */
export function withPhoto(html: string, url: string | null) {
  if (!url) return html.replace(/<img([^>]*)data-photo="1"([^>]*)>/g, '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#888">Photo</div>');
  return html.replace(/(<img[^>]*data-photo="1"[^>]*?)src=""/g, `$1src="${url}"`);
}
