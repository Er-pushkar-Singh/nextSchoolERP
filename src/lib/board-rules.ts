/** UPMSP subject-combination rules, written from the 2027 notices
 *  "Subject Combination Rules for Advance Registration of Class-9 2026-27 and High School Examination 2027" and
 *  "Subject/Group Combination Rules for Intermediate Examination 2027" (private-candidate exam forms, pages 5 and 8).
 *  Rules change by year: re-check against the latest notice before each registration season. */

export type Level = "hs" | "inter";
export type Group = "A" | "B" | "C" | "F1" | "F2" | "I";
export type Check = { ok: boolean; errors: string[]; warnings: string[] };

export const levelOf = (classLevel: number): Level => (classLevel <= 10 ? "hs" : "inter");

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

/* ─────────────── High School (Class 9 advance registration & Class 10 exam) ─────────────── */

const HS_LANG_INDIAN = range(903, 916);
const HS_LANG_CLASSICAL = ["923", "924", "925", "926"];
export const HS_SECOND = [...HS_LANG_INDIAN, "917", ...HS_LANG_CLASSICAL];
const HS_OPTIONAL = ["933", "934", "935", "936", "937", "938", "939", "940", "941", "942", "971", "972", "973", "974", "975"];
const HS_PREVOC = range(945, 969);
const HS_REVISED_VOC = ["701", "702", "703", "704"];

export const HS_SLOT_LABELS: Record<string, string> = {
  "1": "1st compulsory — Hindi / Elementary Hindi", "2": "2nd compulsory — language", "3": "3rd compulsory — Mathematics / Home Science (girls)",
  "4": "4th compulsory — Science", "5": "5th compulsory — Social Science", "6": "6th — optional subject", trade: "Pre-vocational / vocational trade (instead of the 6th)",
  "7": "7th compulsory — Moral, Yoga, Sports & PE",
};

export function optionsForHs(slot: string): string[] {
  switch (slot) {
    case "1": return ["901", "902"];
    case "2": return HS_SECOND;
    case "3": return ["928", "930"];
    case "4": return ["931"];
    case "5": return ["932"];
    case "6": return [...HS_SECOND, ...HS_OPTIONAL];
    case "trade": return [...HS_PREVOC, ...HS_REVISED_VOC];
    case "7": return ["944"];
    default: return [];
  }
}

export function checkHs(sel: Record<string, string>, opts: { gender?: string | null; vocationalAllowed?: boolean } = {}): Check {
  const errors: string[] = [], warnings: string[] = [];
  const req = (slot: string, label: string) => {
    const v = sel[slot];
    if (!v) { errors.push(`${label} is missing.`); return null; }
    if (!optionsForHs(slot).includes(v)) { errors.push(`${v} is not allowed as ${label.toLowerCase()}.`); return null; }
    return v;
  };
  req("1", "1st compulsory subject");
  req("2", "2nd compulsory subject");
  const third = req("3", "3rd compulsory subject");
  if (third === "930" && opts.gender && opts.gender !== "F") errors.push("930 Home Science as the 3rd compulsory subject is for female candidates only.");
  req("4", "4th compulsory subject");
  req("5", "5th compulsory subject");
  const six = sel["6"], trade = sel.trade;
  if (!six && !trade) errors.push("The 6th subject (optional) or a trade subject is required.");
  if (six) {
    if (!optionsForHs("6").includes(six)) errors.push(`${six} is not allowed as the 6th (optional) subject.`);
    if (six === sel["2"]) errors.push("The 6th subject cannot be the same language as the 2nd compulsory subject.");
    if (six === "938" && third === "930") errors.push("938 Home Science is only for those who did not take 930 as a compulsory subject.");
  }
  if (trade) {
    if (!optionsForHs("trade").includes(trade)) errors.push(`${trade} is not a trade subject.`);
    if (six) warnings.push("A trade subject is normally taken in place of the 6th optional subject — check the notice for your institution.");
    if (!opts.vocationalAllowed && HS_PREVOC.includes(trade)) warnings.push("Pre-vocational trades are allowed only in the 37 institutions the Board has authorised.");
  }
  const chosen = Object.entries(sel).filter(([, v]) => v).map(([, v]) => v);
  if (new Set(chosen).size !== chosen.length) errors.push("The same subject is selected twice.");
  return { ok: errors.length === 0, errors, warnings };
}

/* ─────────────── Intermediate (Class 11 advance registration & Class 12 exam) ─────────────── */

export const GROUPS: Record<Group, string> = {
  A: "Humanities (मानविकी)", B: "Science (विज्ञान)", C: "Commerce (वाणिज्य)", F1: "Agriculture Part-1 (कृषि भाग-एक)",
  F2: "Agriculture Part-2 (कृषि भाग-दो)", I: "Vocational (व्यावसायिक)",
};

const IN_INDIAN = ["103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "115", "116", "121"];
const IN_ENGLISH = ["117"];
const IN_CLASSICAL = ["124", "125", "126"];
const LANGS = [...IN_INDIAN, ...IN_ENGLISH, ...IN_CLASSICAL];
/** Humanities "(four)" list — subjects in the same bracket cannot be taken together. */
const HUM_BRACKETS: string[][] = [
  ["128"], ["129"], ["130"], ["131"], ["132"], ["133", "134", "137"], ["135"], ["136"], ["138", "139", "150"], ["140", "141", "149"], ["142"], ["144"],
  ["145", "146", "147"], ["174"], ["175"],
];
const HUM_OTHER = HUM_BRACKETS.flat();
const VOC_FOURTH = [...LANGS.filter((c) => c !== "112"), "128", "129", "130", "131", "132", "133", "134", "135", "136", "137", "138", "139", "140", "141", "142", "151", "152", "153", "174", "200"];
const TRADES = range(202, 245);

export const INTER_COMPULSORY_LAST = "173";

export function interRequiredCount(group: Group) {
  return group === "F1" || group === "F2" ? 6 : group === "I" ? 4 : 5;
}

export function interAllowed(group: Group): string[] {
  switch (group) {
    case "A": return ["101", "102", ...LANGS, ...HUM_OTHER];
    case "B": return ["101", "102", "151", "152", "153", "131", "144", ...LANGS];
    case "C": return ["102", "156", "157", "117", "131", "136", "144"];
    case "F1": return ["101", "102", "163", "164", "165", "166", "167"];
    case "F2": return ["101", "102", "168", "169", "170", "171", "172"];
    case "I": return ["102", "201", ...TRADES, ...VOC_FOURTH];
  }
}

/** `codes` is the ordered list of the subjects selected (not counting 173, which is added by the form). */
export function checkInter(group: Group | null | undefined, codes: string[]): Check {
  const errors: string[] = [], warnings: string[] = [];
  if (!group) return { ok: false, errors: ["Choose the subject group (A, B, C, F1, F2 or I)."], warnings };
  const list = codes.filter(Boolean);
  const need = interRequiredCount(group);
  if (list.length !== need) errors.push(`Group ${group} needs exactly ${need} subjects (plus 173); ${list.length} selected.`);
  if (new Set(list).size !== list.length) errors.push("The same subject is selected twice.");
  const allowed = interAllowed(group);
  for (const c of list) if (!allowed.includes(c)) errors.push(`${c} is not allowed in group ${group}.`);
  const has = (c: string) => list.includes(c);
  const hindi = list.filter((c) => c === "101" || c === "102");
  const langCount = (g: string[]) => list.filter((c) => g.includes(c)).length;

  if (group === "C") {
    if (!has("102")) errors.push("Commerce: 102 General Hindi is compulsory.");
    if (!has("156") || !has("157")) errors.push("Commerce: 156 Accountancy and 157 Business Studies are compulsory.");
    const two = list.filter((c) => ["117", "131", "136", "144"].includes(c));
    if (two.length !== 2) errors.push("Commerce: choose two of 117 English, 131 Mathematics, 136 Economics, 144 Computer.");
  } else if (group === "F1" || group === "F2") {
    if (hindi.length !== 1) errors.push("Choose one of 101 Hindi or 102 General Hindi.");
    const must = group === "F1" ? ["163", "164", "165", "166", "167"] : ["168", "169", "170", "171", "172"];
    for (const m of must) if (!has(m)) errors.push(`${m} is compulsory in group ${group}.`);
  } else if (group === "I") {
    if (!has("102")) errors.push("Vocational: 102 General Hindi is compulsory (101 cannot be chosen).");
    if (!has("201")) errors.push("Vocational: 201 Vocational General Foundation is compulsory.");
    if (list.filter((c) => TRADES.includes(c)).length !== 1) errors.push("Vocational: choose exactly one trade subject (202 to 245).");
    if (list.filter((c) => VOC_FOURTH.includes(c)).length !== 1) errors.push("Vocational: choose exactly one more subject from the allowed list.");
  } else if (group === "A") {
    if (hindi.length !== 1) errors.push("Humanities: choose one of 101 Hindi or 102 General Hindi.");
    if (langCount(IN_INDIAN) > 1) errors.push("Humanities: only one Indian language (103–121) can be taken.");
    if (langCount(IN_CLASSICAL) > 1) errors.push("Humanities: only one classical language (124–126) can be taken.");
    const langs = langCount(LANGS);
    if (langs > 2) errors.push("Humanities: not more than two languages besides Hindi / General Hindi.");
    for (const br of HUM_BRACKETS) if (br.length > 1 && langCount(br) > 1) errors.push(`Humanities: take only one of ${br.join(" / ")}.`);
  } else if (group === "B") {
    if (hindi.length !== 1) errors.push("Science: choose one of 101 Hindi or 102 General Hindi.");
    if (has("153") && has("131")) errors.push("Science: 153 Biology and 131 Mathematics cannot be taken together.");
    if (langCount(LANGS) > 2) errors.push("Science: at most two language subjects (103–126) besides Hindi / General Hindi.");
    if (langCount(IN_INDIAN) > 1 || langCount(IN_CLASSICAL) > 1) errors.push("Science: only one subject can be taken from each language group.");
    const core = list.filter((c) => ["151", "152", "153", "131", "144"].includes(c)).length + langCount(LANGS);
    if (core !== list.length - hindi.length) errors.push("Science: choose subjects only from Physics, Chemistry, Biology / Mathematics, Computer and the languages.");
  }
  warnings.push("Subject 173 (Moral, Yoga, Sports & Physical Education) is added automatically as the 7th subject.");
  return { ok: errors.length === 0, errors, warnings };
}
