// Unit checks for the UPMSP subject rules and the Aadhaar checksum.
//   node scripts/test-rules.mjs
import assert from "node:assert/strict";
import { checkHs, checkInter, optionsForHs } from "../src/lib/board-rules.ts";
import { validAadhaar } from "../src/lib/aadhaar.ts";
import { sanitizeHtml, withPhoto } from "../src/lib/html-sanitize.ts";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok ", name); };

// ── High School ──
const hs = { 1: "901", 2: "917", 3: "928", 4: "931", 5: "932", 6: "941" };
ok("HS: a normal six-subject set is valid", () => assert.equal(checkHs(hs).ok, true));
ok("HS: 930 Home Science is refused for a boy", () => assert.equal(checkHs({ ...hs, 3: "930" }, { gender: "M" }).ok, false));
ok("HS: 930 Home Science is fine for a girl", () => assert.equal(checkHs({ ...hs, 3: "930" }, { gender: "F" }).ok, true));
ok("HS: 6th cannot repeat the 2nd language", () => assert.equal(checkHs({ ...hs, 6: "917" }).ok, false));
ok("HS: 6th language is fine if different from the 2nd", () => assert.equal(checkHs({ ...hs, 2: "904", 6: "917" }).ok, true));
ok("HS: 4th must be 931 Science", () => assert.equal(checkHs({ ...hs, 4: "932" }).ok, false));
ok("HS: missing 6th and trade is an error", () => assert.equal(checkHs({ 1: "901", 2: "917", 3: "928", 4: "931", 5: "932" }).ok, false));
ok("HS: a trade can stand in for the 6th", () => assert.equal(checkHs({ 1: "901", 2: "917", 3: "928", 4: "931", 5: "932", trade: "947" }, { vocationalAllowed: true }).ok, true));
ok("HS: 938 needs that 930 was not taken", () => assert.equal(checkHs({ ...hs, 3: "930", 6: "938" }, { gender: "F" }).ok, false));
ok("HS: slot 7 is only 944", () => assert.deepEqual(optionsForHs("7"), ["944"]));

// ── Intermediate ──
ok("Inter A: Hindi + English + History + Geography + Civics", () => assert.equal(checkInter("A", ["101", "117", "128", "129", "130"]).ok, true));
ok("Inter A: two Indian languages are refused", () => assert.equal(checkInter("A", ["101", "104", "105", "128", "129"]).ok, false));
ok("Inter A: Psychology and Education together are refused", () => assert.equal(checkInter("A", ["101", "133", "134", "128", "129"]).ok, false));
ok("Inter A: wrong count is refused", () => assert.equal(checkInter("A", ["101", "128", "129"]).ok, false));
ok("Inter B: Hindi + Physics + Chemistry + Biology + English", () => assert.equal(checkInter("B", ["101", "151", "152", "153", "117"]).ok, true));
ok("Inter B: Biology with Mathematics is refused", () => assert.equal(checkInter("B", ["101", "151", "152", "153", "131"]).ok, false));
ok("Inter B: PCM + Computer", () => assert.equal(checkInter("B", ["102", "151", "152", "131", "144"]).ok, true));
ok("Inter C: needs 102, 156, 157 and two more", () => assert.equal(checkInter("C", ["102", "156", "157", "117", "131"]).ok, true));
ok("Inter C: 101 Hindi is refused", () => assert.equal(checkInter("C", ["101", "156", "157", "117", "131"]).ok, false));
ok("Inter F1: all five agriculture subjects + Hindi", () => assert.equal(checkInter("F1", ["101", "163", "164", "165", "166", "167"]).ok, true));
ok("Inter F2: missing 172 is refused", () => assert.equal(checkInter("F2", ["101", "168", "169", "170", "171", "173"]).ok, false));
ok("Inter I: 102 + 201 + a trade + one more", () => assert.equal(checkInter("I", ["102", "201", "207", "117"]).ok, true));
ok("Inter I: two trades are refused", () => assert.equal(checkInter("I", ["102", "201", "207", "208"]).ok, false));
ok("Inter: no group is refused", () => assert.equal(checkInter(null, ["101"]).ok, false));

// ── Aadhaar ── (Verhoeff: a number built with its own check digit is valid, any single-digit change is not)
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
function withCheck(body) {
  let c = 0;
  [...body].reverse().forEach((ch, i) => { c = D[c][P[(i + 1) % 8][Number(ch)]]; });
  return body + INV[c];
}
const good = withCheck("23456789012");
ok("Aadhaar: a number with a correct check digit is accepted", () => assert.equal(validAadhaar(good), true));
ok("Aadhaar: a wrong last digit is refused", () => assert.equal(validAadhaar(good.slice(0, 11) + ((Number(good[11]) + 1) % 10)), false));
ok("Aadhaar: spaces are allowed", () => assert.equal(validAadhaar(`${good.slice(0, 4)} ${good.slice(4, 8)} ${good.slice(8)}`), true));
ok("Aadhaar: must not start with 0 or 1", () => assert.equal(validAadhaar(withCheck("01234567890")), false));
ok("Aadhaar: wrong length is refused", () => assert.equal(validAadhaar("1234"), false));


// ── Template HTML sanitiser ──
ok("HTML: scripts are removed", () => assert.ok(!/<script/i.test(sanitizeHtml("<p>a</p><script>alert(1)</script>"))));
ok("HTML: event handlers are removed", () => assert.ok(!/onerror|onclick/i.test(sanitizeHtml('<img src="https://x/y.png" onerror="alert(1)" onclick="x()">'))));
ok("HTML: javascript: links are refused", () => assert.ok(!/javascript/i.test(sanitizeHtml('<img src="javascript:alert(1)">'))));
ok("HTML: iframes and forms are dropped", () => assert.equal(sanitizeHtml('<iframe src="https://evil"></iframe><form><input></form>ok'), "ok"));
ok("HTML: placeholders and tables survive", () => assert.equal(sanitizeHtml('<table><tr><td style="border:1px solid #000">{{student.name}}</td></tr></table>'), '<table><tr><td style="border:1px solid #000">{{student.name}}</td></tr></table>'));
ok("HTML: dangerous css is dropped", () => assert.ok(!/expression/i.test(sanitizeHtml('<div style="width:expression(alert(1))">x</div>'))));
ok("HTML: photo slot gets the signed url", () => assert.ok(withPhoto('<img class="doc-photo" data-photo="1" src="" alt="p">', "https://s/p.jpg").includes('src="https://s/p.jpg"')));
ok("HTML: photo slot falls back to a placeholder", () => assert.ok(!withPhoto('<img data-photo="1" src="">', null).includes("<img")));

console.log(`\n${n} checks passed`);
