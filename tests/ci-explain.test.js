"use strict";
// node --test tests/
// The explanation sentences may only show figures the backend computed:
// every number in a sentence must be one of the data's own values
// (formatted as money / % / count), a date in it, or a count of its rows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let dict = {};
global.CMI18n = { register: o => { dict = { ...dict, ...o }; } };
require("../shared/i18n/explain.js");
const X = require("../assets/js/ci-explain.js");

const tr = lang => (k, vars = {}) => {
  const e = dict[k];
  assert.ok(e, `missing string ${k}`);
  return e[lang].replace(/\{(\w+)\}/g, (_, v) => {
    assert.ok(v in vars, `${k}: no value for {${v}}`);
    return `\u0001${vars[v]}\u0002`;   // marks what came from the data
  });
};
const load = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `ci-${n}.json`), "utf8"));

// Every way a figure from the data may appear in a sentence.
function allowed(data) {
  const out = new Set();
  const { num, pct } = X.fmt;
  const add = v => {
    out.add(num(v));
    [0, 1, 2].forEach(d => out.add(pct(v, d).replace("%", "")));
  };
  (function walk(o) {
    if (Array.isArray(o)) { add(o.length); o.forEach(walk); return; }
    if (o && typeof o === "object") { Object.values(o).forEach(walk); return; }
    if (typeof o === "number") add(o);
    if (typeof o === "string" && /^\d{4}-\d{2}-\d{2}/.test(o)) o.slice(0, 10).split("-").forEach(p => out.add(p));
  })(data);
  return out;
}

// Numbers inside the values put into a sentence (not the sentence's own
// wording, such as "PAR 90" or "over 90 days").
function numbersIn(text) {
  const vals = text.match(/\u0001[^\u0002]*\u0002/g) || [];
  return vals.flatMap(v => v.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []);
}

function rowCounts(data) {
  // counts of rows the sentences may state (quadrants, officers' loans…)
  const s = new Set();
  const rows = data.rows || data.byDim || [];
  for (let i = 0; i <= rows.length; i++) s.add(String(i));
  return s;
}

const CASES = [
  ["overview", "overview"], ["npl", "npl"], ["recovery", "recovery"], ["risk", "risk"],
  ["quality", "quality"], ["growth", "risk"], ["warning", "ews"]
];

for (const [topic, file] of CASES) {
  test(`${topic}: every number comes from the data (km and en)`, () => {
    const data = load(file);
    const ok = allowed(data);
    const counts = rowCounts(data);
    for (const lang of ["km", "en"]) {
      const lines = X[topic](data, tr(lang));
      assert.ok(lines.length >= 1, `${topic} gave no sentence`);
      for (const line of lines) {
        for (const n of numbersIn(line)) {
          assert.ok(ok.has(n) || counts.has(n), `${topic}/${lang}: "${n}" is not a figure from the data — ${line}`);
        }
      }
    }
  });
}

test("no data / not enough history gives a plain sentence, not a crash", () => {
  const t = tr("en");
  assert.deepEqual(X.npl({ movement: { available: false } }, t), [dict["ex.npl.na"].en]);
  assert.deepEqual(X.overview({ empty: true }, t), [dict["ex.none"].en]);
  assert.deepEqual(X.warning({ summary: { high: 0, medium: 0, low: 0, byRule: {}, balance: {} }, rows: [] }, t), [dict["ex.ew.none"].en]);
  assert.deepEqual(X.growth({ rows: [] }, t), [dict["ex.growth.na"].en]);
});

test("NPL: says which side drove the change", () => {
  const t = tr("en");
  const base = { available: true, openingDate: "2026-09-30", closingDate: "2026-10-22", exits: { recovered: { count: 2, bal: 300 }, writeOff: { count: 0, bal: 0 }, moved: { count: 0, bal: 0 } } };
  const m = (open, close, nw) => ({ movement: { ...base, totals: { opening: { bal: open }, closing: { bal: close }, new: { bal: nw, count: 3 }, balanceChange: 0 } } });
  const plain = lines => lines.map(l => l.replace(/[\u0001\u0002]/g, ""));
  assert.equal(plain(X.npl(m(1000, 1200, 500), t)).at(-1), dict["ex.npl.whyUpNew"].en);
  assert.equal(plain(X.npl(m(1000, 800, 100), t)).at(-1), dict["ex.npl.whyDownRec"].en);
});
