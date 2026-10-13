/**
 * Template designer: the canvas model, the compiler (design → HTML the database renders), sample data for previews,
 * the starter gallery and the module registry.
 *
 * REGISTER NEW MODULES HERE (TEMPLATE_MODULES): every module that prints something gets its kinds listed with the
 * placeholders its data builder supplies, and (optionally) starter designs in PRESETS.
 */

export type ItemType = "text" | "rect" | "ellipse" | "line" | "image" | "photo" | "logo";
export type Item = {
  id: string; type: ItemType;
  x: number; y: number; w: number; h: number; rot: number;     // mm, mm, mm, mm, degrees
  locked?: boolean; hidden?: boolean; opacity?: number;
  name?: string;
  text?: string; font?: string; size?: number; weight?: number; italic?: boolean; underline?: boolean;
  align?: "left" | "center" | "right" | "justify"; valign?: "top" | "middle" | "bottom";
  color?: string; lh?: number; ls?: number; upper?: boolean;
  fill?: string; stroke?: string; sw?: number; radius?: number;
  src?: string; fit?: "cover" | "contain";
};
export type Design = { v: 1; w: number; h: number; bg: string; bgImage?: string; items: Item[] };

export const FONTS: [string, string][] = [
  ["Arial, Helvetica, sans-serif", "Arial"], ["'Trebuchet MS', Arial, sans-serif", "Trebuchet"], ["Verdana, Geneva, sans-serif", "Verdana"],
  ["Georgia, 'Times New Roman', serif", "Georgia"], ["'Times New Roman', Times, serif", "Times New Roman"], ["'Courier New', monospace", "Courier"],
  ["'Noto Sans Devanagari', Mangal, Arial, sans-serif", "Hindi (Devanagari)"],
];
export const PAGE_PRESETS: { key: string; label: string; w: number; h: number }[] = [
  { key: "a4p", label: "A4 portrait", w: 210, h: 297 }, { key: "a4l", label: "A4 landscape", w: 297, h: 210 },
  { key: "a5p", label: "A5 portrait", w: 148, h: 210 }, { key: "a5l", label: "A5 landscape", w: 210, h: 148 },
  { key: "cardl", label: "ID card landscape 86×54", w: 86, h: 54 }, { key: "cardp", label: "ID card portrait 54×86", w: 54, h: 86 },
];

const clamp = (n: unknown, lo: number, hi: number, d = 0) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
const r2 = (n: number) => Math.round(n * 100) / 100;
const colour = (v: unknown, d: string) => (typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|transparent|rgba?\([\d.,\s%]+\))$/.test(v) ? v : d);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>()]+$/.test(v) && v.length < 600 ? v : undefined);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT_SET = new Set(FONTS.map(([v]) => v));

/** Brings anything (from the browser, from the database) into the shape and limits the compiler trusts. */
export function normalizeDesign(raw: unknown): Design {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 200).flatMap((it): Item[] => {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const type = o.type as ItemType;
    if (!["text", "rect", "ellipse", "line", "image", "photo", "logo"].includes(type)) return [];
    const base: Item = {
      id: typeof o.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(o.id) ? o.id : `i${Math.random().toString(36).slice(2, 9)}`, type,
      x: r2(clamp(o.x, -300, 600)), y: r2(clamp(o.y, -300, 600)), w: r2(clamp(o.w, 0.5, 600, 20)), h: r2(clamp(o.h, 0.2, 600, 10)), rot: r2(clamp(o.rot, -360, 360)),
      locked: o.locked === true, hidden: o.hidden === true, opacity: clamp(o.opacity, 0, 1, 1), name: typeof o.name === "string" ? o.name.slice(0, 40) : undefined,
    };
    if (type === "text") {
      return [{ ...base, text: typeof o.text === "string" ? o.text.slice(0, 2000) : "", font: FONT_SET.has(o.font as string) ? (o.font as string) : FONTS[0][0], size: clamp(o.size, 4, 120, 11),
        weight: clamp(o.weight, 300, 900, 400), italic: o.italic === true, underline: o.underline === true,
        align: (["left", "center", "right", "justify"].includes(o.align as string) ? o.align : "left") as Item["align"],
        valign: (["top", "middle", "bottom"].includes(o.valign as string) ? o.valign : "top") as Item["valign"],
        color: colour(o.color, "#111111"), lh: clamp(o.lh, 0.8, 3, 1.25), ls: clamp(o.ls, -2, 20, 0), upper: o.upper === true,
        fill: colour(o.fill, "transparent"), radius: clamp(o.radius, 0, 100, 0) }];
    }
    if (type === "image") return [{ ...base, src: https(o.src), fit: o.fit === "contain" ? "contain" : "cover", radius: clamp(o.radius, 0, 100, 0) }];
    if (type === "photo" || type === "logo") return [{ ...base, radius: clamp(o.radius, 0, 100, 0), stroke: colour(o.stroke, "transparent"), sw: clamp(o.sw, 0, 5, 0) }];
    return [{ ...base, fill: colour(o.fill, type === "line" ? "transparent" : "#e5e7eb"), stroke: colour(o.stroke, type === "line" ? "#111111" : "transparent"), sw: clamp(o.sw, 0, 20, type === "line" ? 0.4 : 0),
      radius: clamp(o.radius, 0, 100, 0) }];
  });
  return { v: 1, w: r2(clamp(d.w, 30, 600, 210)), h: r2(clamp(d.h, 30, 600, 297)), bg: colour(d.bg, "#ffffff"), bgImage: https(d.bgImage), items };
}

/** The HTML for a design: every element absolutely positioned in millimetres. {{placeholders}} are left for the database. */
export function compileDesign(input: unknown): string {
  const d = normalizeDesign(input);
  const parts = d.items.filter((i) => !i.hidden).map((i) => {
    const pos = `position:absolute;left:${i.x}mm;top:${i.y}mm;width:${i.w}mm;height:${i.h}mm;box-sizing:border-box;` +
      (i.rot ? `transform:rotate(${i.rot}deg);` : "") + ((i.opacity ?? 1) < 1 ? `opacity:${i.opacity};` : "");
    if (i.type === "text") {
      const jc = i.valign === "middle" ? "center" : i.valign === "bottom" ? "flex-end" : "flex-start";
      const st = `${pos}display:flex;flex-direction:column;justify-content:${jc};overflow:hidden;font-family:${i.font};font-size:${i.size}pt;font-weight:${i.weight};` +
        `${i.italic ? "font-style:italic;" : ""}${i.underline ? "text-decoration:underline;" : ""}text-align:${i.align};color:${i.color};line-height:${i.lh};` +
        `${i.ls ? `letter-spacing:${i.ls / 10}pt;` : ""}${i.upper ? "text-transform:uppercase;" : ""}${i.fill && i.fill !== "transparent" ? `background:${i.fill};` : ""}` +
        `${i.radius ? `border-radius:${i.radius}mm;` : ""}`;
      return `<div style="${st}"><div>${esc(i.text ?? "").replace(/\n/g, "<br>")}</div></div>`;
    }
    if (i.type === "rect" || i.type === "ellipse") {
      return `<div style="${pos}background:${i.fill};${i.sw ? `border:${i.sw}mm solid ${i.stroke};` : ""}border-radius:${i.type === "ellipse" ? "50%" : `${i.radius ?? 0}mm`};"></div>`;
    }
    if (i.type === "line") {
      return `<div style="position:absolute;left:${i.x}mm;top:${i.y}mm;width:${i.w}mm;height:${Math.max(i.sw ?? 0.4, 0.1)}mm;background:${i.stroke};box-sizing:border-box;${i.rot ? `transform:rotate(${i.rot}deg);transform-origin:left center;` : ""}${(i.opacity ?? 1) < 1 ? `opacity:${i.opacity};` : ""}"></div>`;
    }
    if (i.type === "image") {
      return `<div style="${pos}overflow:hidden;${i.radius ? `border-radius:${i.radius}mm;` : ""}">${i.src ? `<img src="${esc(i.src)}" alt="" style="width:100%;height:100%;object-fit:${i.fit}">` : ""}</div>`;
    }
    const border = i.sw ? `border:${i.sw}mm solid ${i.stroke};` : "";
    return `<div style="${pos}overflow:hidden;${border}${i.radius ? `border-radius:${i.radius}mm;` : ""}">${i.type === "photo" ? "{{student.photo}}" : "{{school.logo}}"}</div>`;
  });
  const bgi = d.bgImage ? `background-image:url('${esc(d.bgImage)}');background-size:cover;background-position:center;` : "";
  return `<div style="position:relative;width:${d.w}mm;height:${d.h}mm;background:${d.bg};${bgi}overflow:hidden;box-sizing:border-box;margin:0 auto">${parts.join("")}</div>`;
}

/** page_size / orientation / card size the template row needs for a design */
export function pageOf(d: Design) {
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  if (near(d.w, 210) && near(d.h, 297)) return { page_size: "A4", orientation: "portrait", card_width_mm: null, card_height_mm: null };
  if (near(d.w, 297) && near(d.h, 210)) return { page_size: "A4", orientation: "landscape", card_width_mm: null, card_height_mm: null };
  if (near(d.w, 148) && near(d.h, 210)) return { page_size: "A5", orientation: "portrait", card_width_mm: null, card_height_mm: null };
  if (near(d.w, 210) && near(d.h, 148)) return { page_size: "A5", orientation: "landscape", card_width_mm: null, card_height_mm: null };
  return { page_size: "card", orientation: d.w >= d.h ? "landscape" : "portrait", card_width_mm: Math.round(Math.min(300, Math.max(30, d.w))), card_height_mm: Math.round(Math.min(300, Math.max(30, d.h))) };
}

/* ───────────── sample data (previews only — real documents use the school's records) ───────────── */
const SAMPLE: Record<string, string> = {
  "student.name": "Aarav Sharma", "student.name_hi": "आरव शर्मा", "student.first_name": "Aarav", "student.admission_no": "A-2026-014", "student.roll_no": "12",
  "student.class": "7", "student.section": "B", "student.class_section": "7-B", "student.father_name": "Rajesh Sharma", "student.father_name_hi": "राजेश शर्मा",
  "student.mother_name": "Sunita Sharma", "student.dob": "14/08/2014", "student.dob_words": "Fourteenth August, Two Thousand Fourteen", "student.gender": "Male",
  "student.son_daughter": "son", "student.he_she": "he", "student.his_her": "his", "student.category": "General", "student.religion": "Hindu", "student.nationality": "Indian",
  "student.blood_group": "B+", "student.address": "12, Gandhi Nagar, Lucknow", "student.phone": "98765 43210", "student.mobile": "98765 43210", "student.email": "parent@example.com",
  "student.admission_date": "01/04/2022", "student.admission_class": "3", "student.apaar_id": "1234 5678 9012", "student.tc_no": "TC/2026-27/0012",
  "student.transport_route": "Route 4 — Aliganj", "student.transport_stop": "Kapoorthala", "staff.name": "Meena Srivastava", "staff.designation": "PGT Physics", "staff.department": "Science",
  "staff.emp_code": "EMP-014", "staff.phone": "98765 11111", "staff.email": "meena@school.example", "staff.joining_date": "01/07/2018", "staff.qualification": "M.Sc., B.Ed.",
  "school.name": "Sunrise Public School", "school.address": "Sector 12, Vikas Nagar", "school.city": "Lucknow", "school.pincode": "226022", "school.phone": "0522-4000000",
  "school.email": "office@sunrise.example", "school.board": "UP Board", "school.affiliation_no": "2130456", "school.udise_code": "09530100101", "school.principal_name": "Dr. A. K. Verma",
  "doc.no": "ID/2026-27/0001", "doc.date": "13/10/2026", "doc.session": "2026-27", "doc.valid_until": "31/03/2027", "dues.text": "No fee dues are pending.", "dues.outstanding": "₹0",
  "extra.reason": "Parent transferred", "extra.remarks": "—", "extra.exam": "Half-yearly examination 2026", "extra.centre": "Main block, Room 14", "extra.conduct": "Very good",
  "fee.receipt_no": "R00123", "fee.date": "13/10/2026", "fee.amount": "₹4,500.00", "fee.amount_words": "Four Thousand Five Hundred Rupees Only", "fee.mode": "Cash", "fee.payments": "Cash ₹3,000.00 + UPI ₹1,500.00",
  "fee.reference": "UPI123", "fee.note": "", "fee.collected_by": "Sunita (Accounts)", "fee.balance": "₹9,000.00", "fee.advance": "", "fee.wallet_used": "", "fee.status": "",
  "fee.total_due": "₹9,000.00", "fee.overdue": "₹4,500.00", "fee.due_words": "Nine Thousand Rupees Only", "fee.paid_total": "₹13,500.00", "fee.billed_total": "₹22,500.00", "fee.as_on": "13/10/2026",
  "fee.lines_html": '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr><td style="border:1px solid #444;padding:3px 6px">Tuition Fee · Oct 2026</td><td style="border:1px solid #444;padding:3px 6px;text-align:right">₹3,000.00</td></tr><tr><td style="border:1px solid #444;padding:3px 6px">Exam Fee · Half-yearly</td><td style="border:1px solid #444;padding:3px 6px;text-align:right">₹1,500.00</td></tr></table>',
  "fee.dues_html": '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr><td style="border:1px solid #444;padding:3px 6px">Tuition Fee · Sep 2026</td><td style="border:1px solid #444;padding:3px 6px">10/09/2026</td><td style="border:1px solid #444;padding:3px 6px;text-align:right">₹3,000.00</td></tr><tr><td style="border:1px solid #444;padding:3px 6px">Tuition Fee · Oct 2026</td><td style="border:1px solid #444;padding:3px 6px">10/10/2026</td><td style="border:1px solid #444;padding:3px 6px;text-align:right">₹3,000.00</td></tr></table>',
  "fee.receipts_html": '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr><td style="border:1px solid #444;padding:3px 6px">R00101</td><td style="border:1px solid #444;padding:3px 6px">05/04/2026</td><td style="border:1px solid #444;padding:3px 6px;text-align:right">₹9,000.00</td></tr></table>',
};
const human = (k: string) => k.split(".").pop()!.replace(/_/g, " ");

/** Replaces {{placeholders}} with sample values (for the designer and the gallery thumbnails). */
export function withSample(html: string): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k: string) => {
    if (k === "student.photo") return `<div style="width:100%;height:100%;background:linear-gradient(135deg,#cbd5e1,#94a3b8);display:flex;align-items:flex-end;justify-content:center"><div style="width:44%;height:44%;border-radius:50%;background:#e2e8f0;margin-bottom:12%"></div></div>`;
    if (k === "school.logo") return `<div style="width:100%;height:100%;border-radius:50%;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">SPS</div>`;
    if (k.endsWith("_html")) return SAMPLE[k] ?? "";
    const v = SAMPLE[k] ?? `‹${human(k)}›`;
    return v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  });
}

/* ───────────── building starter designs ───────────── */
let seq = 0;
const uid = () => `p${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const T = (x: number, y: number, w: number, h: number, text: string, o: Partial<Item> = {}): Item =>
  ({ id: uid(), type: "text", x, y, w, h, rot: 0, text, size: 9, weight: 400, color: "#111111", align: "left", valign: "top", ...o });
const R = (x: number, y: number, w: number, h: number, fill: string, o: Partial<Item> = {}): Item => ({ id: uid(), type: "rect", x, y, w, h, rot: 0, fill, stroke: "transparent", sw: 0, radius: 0, ...o });
const L = (x: number, y: number, w: number, o: Partial<Item> = {}): Item => ({ id: uid(), type: "line", x, y, w, h: 0.4, rot: 0, stroke: "#111111", sw: 0.4, ...o });
const PH = (x: number, y: number, w: number, h: number, o: Partial<Item> = {}): Item => ({ id: uid(), type: "photo", x, y, w, h, rot: 0, radius: 2, stroke: "#ffffff", sw: 0.6, ...o });
const LG = (x: number, y: number, w: number, h: number, o: Partial<Item> = {}): Item => ({ id: uid(), type: "logo", x, y, w, h, rot: 0, ...o });

const letterhead = (w: number, brand = "#1d4ed8"): Item[] => [
  LG(12, 8, 18, 18),
  T(34, 8, w - 46, 9, "{{school.name}}", { size: 18, weight: 800, color: brand, upper: true }),
  T(34, 17, w - 46, 10, "{{school.address}}, {{school.city}} {{school.pincode}}\n{{school.board}} · Aff. No. {{school.affiliation_no}} · {{school.phone}}", { size: 8.5, color: "#444444", lh: 1.35 }),
  L(12, 29, w - 24, { stroke: brand, sw: 0.8 }),
];

export type Preset = {
  key: string; name: string; module: string; kind: string; description: string;
  category: "certificate" | "id_card" | "letter" | "fees" | "other"; audience: "student" | "staff";
  target?: string;                    // apply to the school's existing template with this code (fee templates)
  fields?: { key: string; label: string; type: "text" | "date" | "number"; required?: boolean }[];
  build: () => Design;
};

export const PRESETS: Preset[] = [
  {
    key: "id_student_portrait", name: "Student ID card — portrait", module: "students", kind: "id_card", category: "id_card", audience: "student",
    description: "54 × 86 mm vertical card with photo, class and parent phone.",
    build: () => ({ v: 1, w: 54, h: 86, bg: "#ffffff", items: [
      R(0, 0, 54, 30, "#1d4ed8"), R(0, 26, 54, 6, "#1d4ed8", { radius: 0, opacity: 0.35 }),
      LG(4, 3, 10, 10), T(15, 3.5, 36, 10, "{{school.name}}", { size: 8.5, weight: 800, color: "#ffffff", upper: true, valign: "middle", lh: 1.15 }),
      T(4, 15, 46, 5, "STUDENT IDENTITY CARD", { size: 6.5, weight: 700, color: "#dbeafe", ls: 6 }),
      PH(15, 21, 24, 29, { radius: 2 }),
      T(2, 52, 50, 7, "{{student.name}}", { size: 11, weight: 800, align: "center", valign: "middle" }),
      T(2, 59, 50, 5, "Class {{student.class_section}} · Roll {{student.roll_no}}", { size: 8, align: "center", color: "#1d4ed8", weight: 700 }),
      T(6, 65, 42, 14, "Adm. no.: {{student.admission_no}}\nFather: {{student.father_name}}\nPhone: {{student.phone}}", { size: 7, lh: 1.5 }),
      R(0, 80, 54, 6, "#1d4ed8"), T(0, 80, 54, 6, "Valid until {{doc.valid_until}}", { size: 6.5, color: "#ffffff", align: "center", valign: "middle", weight: 700 }),
    ] }),
  },
  {
    key: "id_student_landscape", name: "Student ID card — landscape", module: "students", kind: "id_card", category: "id_card", audience: "student",
    description: "86 × 54 mm standard card, photo on the left.",
    build: () => ({ v: 1, w: 86, h: 54, bg: "#ffffff", items: [
      R(0, 0, 86, 13, "#0f766e"), LG(3, 1.5, 10, 10), T(15, 1.5, 68, 10, "{{school.name}}", { size: 10, weight: 800, color: "#ffffff", upper: true, valign: "middle" }),
      PH(4, 17, 22, 28, { radius: 1.5 }),
      T(30, 16, 54, 7, "{{student.name}}", { size: 12, weight: 800, valign: "middle" }),
      T(30, 24, 54, 22, "Class: {{student.class_section}}   Roll: {{student.roll_no}}\nAdm. no.: {{student.admission_no}}\nFather: {{student.father_name}}\nDOB: {{student.dob}}   Blood: {{student.blood_group}}\nPhone: {{student.phone}}", { size: 7.5, lh: 1.55 }),
      R(0, 48, 86, 6, "#0f766e"), T(0, 48, 86, 6, "{{school.address}}, {{school.city}} · {{school.phone}}", { size: 6, color: "#ffffff", align: "center", valign: "middle" }),
    ] }),
  },
  {
    key: "id_staff", name: "Staff ID card", module: "staff", kind: "id_card", category: "id_card", audience: "staff",
    description: "86 × 54 mm card with name, designation and employee code.",
    build: () => ({ v: 1, w: 86, h: 54, bg: "#ffffff", items: [
      R(0, 0, 86, 54, "#f8fafc"), R(0, 0, 8, 54, "#7c3aed"),
      LG(12, 4, 13, 13), T(28, 4, 55, 13, "{{school.name}}", { size: 10, weight: 800, color: "#4c1d95", upper: true, valign: "middle" }),
      L(12, 19.5, 70, { stroke: "#7c3aed", sw: 0.4 }),
      T(12, 22, 70, 8, "{{staff.name}}", { size: 14, weight: 800, valign: "middle" }),
      T(12, 31, 70, 6, "{{staff.designation}} · {{staff.department}}", { size: 9, color: "#4c1d95", weight: 700 }),
      T(12, 38, 70, 12, "Employee code: {{staff.emp_code}}\nPhone: {{staff.phone}}\nValid until: {{doc.valid_until}}", { size: 7.5, lh: 1.5 }),
    ] }),
  },
  {
    key: "library_card", name: "Library card", module: "library", kind: "library_card", category: "id_card", audience: "student",
    description: "86 × 54 mm member card for the library.",
    build: () => ({ v: 1, w: 86, h: 54, bg: "#fffbeb", items: [
      R(0, 0, 86, 12, "#b45309"), T(4, 0, 78, 12, "LIBRARY CARD — {{school.name}}", { size: 9.5, weight: 800, color: "#ffffff", valign: "middle", upper: true }),
      T(5, 16, 76, 8, "{{student.name}}", { size: 13, weight: 800, valign: "middle" }),
      T(5, 25, 76, 16, "Class: {{student.class_section}}   Adm. no.: {{student.admission_no}}\nMember no.: {{doc.no}}\nValid until: {{doc.valid_until}}", { size: 8, lh: 1.6 }),
      L(5, 46, 76, { stroke: "#b45309", sw: 0.3 }), T(5, 47, 76, 5, "Books are issued on this card. Please return on time.", { size: 6.5, color: "#78350f" }),
    ] }),
  },
  {
    key: "transport_pass", name: "Bus / transport pass", module: "transport", kind: "transport_pass", category: "id_card", audience: "student",
    description: "86 × 54 mm pass showing route and stop.",
    build: () => ({ v: 1, w: 86, h: 54, bg: "#ffffff", items: [
      R(0, 0, 86, 54, "#ecfeff"), R(0, 0, 86, 12, "#0e7490"), T(4, 0, 78, 12, "SCHOOL BUS PASS", { size: 11, weight: 800, color: "#ffffff", valign: "middle", ls: 10 }),
      PH(4, 15, 18, 22, { radius: 1.5 }),
      T(26, 15, 58, 7, "{{student.name}}", { size: 11.5, weight: 800, valign: "middle" }),
      T(26, 23, 58, 18, "Class {{student.class_section}} · Adm. {{student.admission_no}}\nRoute: {{student.transport_route}}\nStop: {{student.transport_stop}}", { size: 8, lh: 1.55 }),
      R(0, 46, 86, 8, "#0e7490"), T(0, 46, 86, 8, "{{school.name}} · Valid until {{doc.valid_until}}", { size: 6.5, color: "#ffffff", align: "center", valign: "middle" }),
    ] }),
  },
  {
    key: "admit_card", name: "Exam admit card", module: "exams", kind: "admit_card", category: "certificate", audience: "student",
    description: "A5 landscape admit card with exam name and centre asked at issue.",
    fields: [{ key: "exam", label: "Examination", type: "text", required: true }, { key: "centre", label: "Centre / room", type: "text" }],
    build: () => ({ v: 1, w: 210, h: 148, bg: "#ffffff", items: [
      ...letterhead(210, "#0f766e"),
      T(12, 33, 186, 9, "ADMIT CARD", { size: 16, weight: 800, align: "center", ls: 40 }),
      T(12, 43, 186, 7, "{{extra.exam}}", { size: 11, align: "center", color: "#444444" }),
      PH(160, 54, 34, 42, { radius: 1.5, stroke: "#444444", sw: 0.3 }),
      T(14, 56, 140, 40, "Name: {{student.name}}\nClass / section: {{student.class_section}}\nRoll no.: {{student.roll_no}}\nAdmission no.: {{student.admission_no}}\nFather: {{student.father_name}}\nCentre: {{extra.centre}}", { size: 11, lh: 1.7 }),
      T(14, 112, 90, 22, "Instructions: bring this card to every paper; no electronic devices; report 20 minutes early.", { size: 8, color: "#555555" }),
      L(140, 128, 56), T(140, 129.5, 56, 5, "Principal", { size: 8, align: "center" }),
    ] }),
  },
  {
    key: "bonafide", name: "Bonafide certificate", module: "students", kind: "certificate", category: "certificate", audience: "student",
    description: "A4 certificate on the school's letterhead.",
    fields: [{ key: "purpose", label: "Purpose", type: "text" }],
    build: () => ({ v: 1, w: 210, h: 297, bg: "#ffffff", items: [
      ...letterhead(210),
      T(12, 36, 90, 6, "No.: {{doc.no}}", { size: 10, weight: 700 }), T(110, 36, 88, 6, "Date: {{doc.date}}", { size: 10, weight: 700, align: "right" }),
      T(12, 50, 186, 12, "BONAFIDE CERTIFICATE", { size: 20, weight: 800, align: "center", underline: true, valign: "middle" }),
      T(20, 75, 170, 70, "This is to certify that {{student.name}}, {{student.son_daughter}} of {{student.father_name}} and {{student.mother_name}}, is a bonafide student of this school, studying in Class {{student.class_section}} for the session {{doc.session}} (Admission no. {{student.admission_no}}).\n\nAccording to the school records {{student.his_her}} date of birth is {{student.dob}}.\n\nThis certificate is issued on the request of the parent{{extra.purpose}}.", { size: 13, lh: 1.9, align: "justify" }),
      L(130, 240, 62), T(130, 242, 62, 12, "Principal\n{{school.name}}", { size: 10, align: "center", lh: 1.4 }),
    ] }),
  },
  {
    key: "letterhead", name: "Letterhead (blank)", module: "students", kind: "letter", category: "letter", audience: "student",
    description: "A4 letterhead with space for any letter — fees notice, circular, appointment.",
    build: () => ({ v: 1, w: 210, h: 297, bg: "#ffffff", items: [
      ...letterhead(210), T(12, 36, 186, 6, "Date: {{doc.date}}", { size: 10, align: "right" }),
      T(12, 48, 186, 200, "Write the letter here…", { size: 12, lh: 1.7 }),
      L(12, 280, 186, { stroke: "#cbd5e1", sw: 0.3 }), T(12, 282, 186, 6, "{{school.name}} · {{school.phone}} · {{school.email}}", { size: 8, align: "center", color: "#64748b" }),
    ] }),
  },
  {
    key: "fee_receipt_design", name: "Fee receipt", module: "fees", kind: "fee_receipt", category: "fees", audience: "student", target: "fee_receipt",
    description: "A5 receipt: school header, payer, what was paid, amount in words, balance.",
    build: () => ({ v: 1, w: 148, h: 210, bg: "#ffffff", items: [
      LG(8, 6, 16, 16), T(28, 6, 112, 8, "{{school.name}}", { size: 15, weight: 800, color: "#1d4ed8", upper: true }),
      T(28, 14, 112, 9, "{{school.address}}, {{school.city}} {{school.pincode}} · {{school.phone}}", { size: 8, color: "#444444", lh: 1.35 }),
      L(8, 26, 132, { stroke: "#1d4ed8", sw: 0.7 }),
      T(8, 29, 132, 7, "FEE RECEIPT  {{fee.status}}", { size: 12, weight: 800, align: "center", ls: 20 }),
      T(8, 38, 64, 6, "Receipt no.: {{fee.receipt_no}}", { size: 9.5, weight: 700 }), T(76, 38, 64, 6, "Date: {{fee.date}}", { size: 9.5, weight: 700, align: "right" }),
      T(8, 46, 132, 16, "Student: {{student.name}}   Adm. no.: {{student.admission_no}}\nClass: {{student.class_section}}   Father: {{student.father_name}}", { size: 9.5, lh: 1.6 }),
      T(8, 66, 132, 62, "{{fee.lines_html}}", { size: 9 }),
      T(8, 130, 132, 20, "In words: {{fee.amount_words}}\nPaid by: {{fee.payments}}\nBalance after this receipt: {{fee.balance}}", { size: 9.5, lh: 1.6 }),
      T(8, 178, 70, 6, "Received by: {{fee.collected_by}}", { size: 9 }), L(94, 180, 46), T(94, 181.5, 46, 5, "Authorised signatory", { size: 8, align: "center" }),
      T(8, 196, 132, 8, "Fees once paid are not refundable. Computer generated receipt.", { size: 7.5, color: "#666666" }),
    ] }),
  },
  {
    key: "fee_demand_design", name: "Fee demand notice", module: "fees", kind: "fee_demand", category: "fees", audience: "student", target: "fee_demand",
    description: "A4 notice listing the dues, with amount in words.",
    build: () => ({ v: 1, w: 210, h: 297, bg: "#ffffff", items: [
      ...letterhead(210, "#b91c1c"),
      T(12, 34, 90, 6, "Date: {{fee.as_on}}", { size: 10, weight: 700 }), T(110, 34, 88, 6, "Session: {{doc.session}}", { size: 10, weight: 700, align: "right" }),
      T(12, 46, 186, 10, "FEE DEMAND NOTICE", { size: 17, weight: 800, align: "center", ls: 20, valign: "middle" }),
      T(14, 62, 182, 24, "To the Parent / Guardian of {{student.name}}\nAdm. no. {{student.admission_no}} · Class {{student.class_section}}\nFather: {{student.father_name}}", { size: 11.5, lh: 1.7 }),
      T(14, 90, 182, 20, "The following fees are outstanding. You are requested to pay {{fee.total_due}} ({{fee.due_words}}) at the school office at the earliest.", { size: 11.5, lh: 1.7, align: "justify" }),
      T(14, 114, 182, 100, "{{fee.dues_html}}", { size: 10 }),
      T(14, 222, 182, 12, "If you have already paid, please ignore this notice or show the receipt at the office.", { size: 10, color: "#555555" }),
      L(140, 262, 56), T(140, 264, 56, 10, "Principal\n(signature & school seal)", { size: 9, align: "center", lh: 1.4 }),
    ] }),
  },
  {
    key: "fee_statement_design", name: "Fee statement", module: "fees", kind: "fee_statement", category: "fees", audience: "student", target: "fee_statement",
    description: "A4 statement of instalments and receipts.",
    build: () => ({ v: 1, w: 210, h: 297, bg: "#ffffff", items: [
      ...letterhead(210, "#0f766e"),
      T(12, 34, 186, 10, "FEE STATEMENT — {{doc.session}}", { size: 16, weight: 800, align: "center", valign: "middle" }),
      T(12, 48, 186, 12, "{{student.name}} · Adm. no. {{student.admission_no}} · Class {{student.class_section}} · Father: {{student.father_name}}", { size: 10.5, lh: 1.5 }),
      T(12, 64, 186, 80, "{{fee.dues_html}}", { size: 9.5 }),
      T(12, 150, 186, 6, "Receipts", { size: 11, weight: 800 }),
      T(12, 158, 186, 70, "{{fee.receipts_html}}", { size: 9.5 }),
      T(12, 236, 186, 10, "Billed {{fee.billed_total}} · Paid {{fee.paid_total}} · Outstanding {{fee.total_due}}  {{fee.advance}}", { size: 11, weight: 800 }),
    ] }),
  },
];

/* ───────────── module registry: what each module can print ───────────── */
export type TemplateKind = { key: string; name: string; ready: boolean; note?: string; presets: string[] };
export const TEMPLATE_MODULES: { module: string; name: string; icon: string; kinds: TemplateKind[] }[] = [
  { module: "students", name: "Students", icon: "students", kinds: [
    { key: "id_card", name: "ID card", ready: true, presets: ["id_student_portrait", "id_student_landscape"] },
    { key: "certificate", name: "Certificates (bonafide, character, TC…)", ready: true, presets: ["bonafide"] },
    { key: "letter", name: "Letters & notices", ready: true, presets: ["letterhead"] },
  ] },
  { module: "staff", name: "Staff & HR", icon: "hr", kinds: [
    { key: "id_card", name: "Staff ID card", ready: true, presets: ["id_staff"] },
    { key: "letter", name: "Experience / appointment letter", ready: true, presets: ["letterhead"], note: "Uses the letterhead; staff placeholders are available." },
    { key: "payslip", name: "Payslip layout", ready: false, presets: [], note: "Planned — needs the payroll data builder." },
  ] },
  { module: "fees", name: "Fees", icon: "fees", kinds: [
    { key: "fee_receipt", name: "Fee receipt", ready: true, presets: ["fee_receipt_design"] },
    { key: "fee_demand", name: "Fee demand notice", ready: true, presets: ["fee_demand_design"] },
    { key: "fee_statement", name: "Fee statement", ready: true, presets: ["fee_statement_design"] },
  ] },
  { module: "exams", name: "Exams", icon: "exams", kinds: [
    { key: "admit_card", name: "Admit card", ready: true, presets: ["admit_card"] },
    { key: "report_card", name: "Report card layout", ready: false, presets: [], note: "Planned — report cards are generated by the results module today." },
  ] },
  { module: "library", name: "Library", icon: "library", kinds: [
    { key: "library_card", name: "Library member card", ready: true, presets: ["library_card"] },
    { key: "issue_slip", name: "Book issue slip", ready: false, presets: [], note: "Planned — needs the library issue data builder." },
  ] },
  { module: "transport", name: "Transport", icon: "transport", kinds: [
    { key: "transport_pass", name: "Bus pass", ready: true, presets: ["transport_pass"] },
  ] },
  { module: "admissions", name: "Admissions", icon: "admissions", kinds: [
    { key: "offer_letter", name: "Offer letter / admission confirmation", ready: false, presets: [], note: "Planned — the application data builder is the next step." },
    { key: "application_form", name: "Application form print", ready: false, presets: [], note: "Planned." },
  ] },
  { module: "hostel", name: "Hostel, inventory, health", icon: "school", kinds: [
    { key: "later", name: "Templates arrive with these modules", ready: false, presets: [], note: "Each new module registers its kinds and placeholders here." },
  ] },
];

export const presetByKey = (k: string) => PRESETS.find((p) => p.key === k);
