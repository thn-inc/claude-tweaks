// Counterfactual from logs: had each lens run ONE reviewer instead of a pair, how many of the findings the review
// went on to confirm would still have been raised, and at what lens cost? Reads each archived lens agent's own table.
// usage: node counterfactual.js <baseline.ndjson>
const fs = require('fs');
const path = require('path');
const ROOT = require('os').homedir() + '/.claude/projects';
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.usable);

// index every subagent transcript by agent id
const idx = new Map();
for (const pr of fs.readdirSync(ROOT)) {
  const d = path.join(ROOT, pr); let ss; try { ss = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
  for (const s of ss) { if (!s.isDirectory()) continue; const sd = path.join(d, s.name, 'subagents'); let fsn; try { fsn = fs.readdirSync(sd); } catch { continue; }
    for (const f of fsn) { const m = f.match(/^agent-([0-9a-f]+)\.jsonl$/); if (m) idx.set(m[1], path.join(sd, f)); } }
}
function finalText(file) {
  let last = '';
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue; let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) for (const b of e.message.content) if (b.type === 'text' && /\|.*\||No findings/.test(b.text)) last = b.text;
  }
  return last;
}
function parseTable(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if (c.length < 5) continue;
    const sev = c[1].toLowerCase().replace(/[*`]/g, '');
    if (!/^(critical|high|medium|low|info)$/.test(sev)) continue;
    const m = c[2].replace(/[`*]/g, '').match(/^(.+?):(\d+)/);
    if (!m) continue;
    out.push({ sev, path: m[1].trim(), line: +m[2], text: c[3] });
  }
  return out;
}
const near = (a, p, l, tol) => a.path === p && Math.abs(a.line - l) <= tol;
const SEV = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const T = { runs: 0, lensPairs: 0, confirmed: 0, confByA: 0, confByB: 0, confByBoth: 0, confUnmatched: 0, refuted: 0, refByA: 0, refByB: 0,
  medConf: 0, medByA: 0, medByB: 0, rowsA: 0, rowsB: 0, outA: 0, outB: 0, ccA: 0, ccB: 0, tbBase: 0, tbOut: 0, tbCc: 0, missingTranscript: 0, statusOnly: 0 };
const perLens = {};
const timing = dir => JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8')).dispatches.items;
for (const r of rows) {
  const items = timing(r.dir).filter(x => /^(Review )?[Ll]ens 3[a-j]/.test(x.description || ''));
  const by = {};
  for (const x of items) {
    const lens = x.description.match(/3[a-j]/)[0];
    const side = (x.description.match(/\b(?:agent |reviewer )?\(?([AB])\)?\s*$/) || [])[1];
    if (!side) continue;
    const f = idx.get(x.agentId);
    if (!f) { T.missingTranscript++; continue; }
    (by[lens] = by[lens] || {})[side] = { rows: parseTable(finalText(f)), out: x.tokens.output, cc: x.tokens.cacheCreate };
  }
  let ok = false;
  for (const [lens, pair] of Object.entries(by)) {
    if (!pair.A || !pair.B) continue;
    ok = true; T.lensPairs++;
    const L = perLens[lens] || (perLens[lens] = { pairs: 0, conf: 0, a: 0, b: 0, both: 0, ref: 0, refA: 0, refB: 0, rowsA: 0, rowsB: 0 });
    L.pairs++; L.rowsA += pair.A.rows.length; L.rowsB += pair.B.rows.length;
    T.rowsA += pair.A.rows.length; T.rowsB += pair.B.rows.length; T.outA += pair.A.out; T.outB += pair.B.out; T.ccA += pair.A.cc; T.ccB += pair.B.cc;
    for (const c of r.confirmed.filter(c => c.lens === lens)) {
      const [p, l] = [c.loc.slice(0, c.loc.lastIndexOf(':')), +c.loc.slice(c.loc.lastIndexOf(':') + 1)];
      const a = pair.A.rows.find(x => near(x, p, l, 5)), b = pair.B.rows.find(x => near(x, p, l, 5));
      T.confirmed++; L.conf++;
      if (a) { T.confByA++; L.a++; } if (b) { T.confByB++; L.b++; } if (a && b) { T.confByBoth++; L.both++; }
      if (!a && !b) T.confUnmatched++;
      const sev = Math.max(a ? SEV[a.sev] : -1, b ? SEV[b.sev] : -1);
      if (sev >= 2) { T.medConf++; if (a) T.medByA++; if (b) T.medByB++; }
    }
    for (const c of r.refuted.filter(c => c.lens === lens)) {
      const [p, l] = [c.loc.slice(0, c.loc.lastIndexOf(':')), +c.loc.slice(c.loc.lastIndexOf(':') + 1)];
      T.refuted++; L.ref++;
      if (pair.A.rows.find(x => near(x, p, l, 5))) { T.refByA++; L.refA++; }
      if (pair.B.rows.find(x => near(x, p, l, 5))) { T.refByB++; L.refB++; }
    }
  }
  if (ok) { T.runs++; T.tbBase += r.tiebreakAgents.length; T.tbOut += r.cost.tbOut; T.tbCc += r.cost.tbCc; }
}
const pct = (a, b) => (100 * a / (b || 1)).toFixed(1) + '%';
console.log('runs', T.runs, '| lens pairs', T.lensPairs, '| lens transcripts missing', T.missingTranscript);
console.log('rows raised: reviewer A', T.rowsA, '| reviewer B', T.rowsB);
console.log('confirmed findings (pair or tiebreak)', T.confirmed, '| located in a reviewer table', T.confirmed - T.confUnmatched, '| not located', T.confUnmatched);
console.log('  raised by A', T.confByA, pct(T.confByA, T.confirmed - T.confUnmatched), '| by B', T.confByB, pct(T.confByB, T.confirmed - T.confUnmatched), '| by both', T.confByBoth, pct(T.confByBoth, T.confirmed - T.confUnmatched));
console.log('  medium-or-higher confirmed', T.medConf, '| by A', T.medByA, pct(T.medByA, T.medConf), '| by B', T.medByB, pct(T.medByB, T.medConf));
console.log('refuted findings', T.refuted, '| raised by A', T.refByA, '| by B', T.refByB);
console.log('lens cost: output tokens A', T.outA, 'B', T.outB, '| cache-create A', T.ccA, 'B', T.ccB);
console.log('tiebreak agents in baseline', T.tbBase, '| output', T.tbOut, '| cache-create', T.tbCc, '| per tiebreak out', Math.round(T.tbOut / T.tbBase), 'cc', Math.round(T.tbCc / T.tbBase));
console.log('\nlens  pairs  confirmed  byA    byB    both   single-reviewer recall (mean of A,B)  refuted  rows/reviewer');
for (const [k, L] of Object.entries(perLens).sort())
  console.log(k.padEnd(5), String(L.pairs).padStart(5), String(L.conf).padStart(9), String(L.a).padStart(6), String(L.b).padStart(6), String(L.both).padStart(6), pct((L.a + L.b) / 2, L.conf).padStart(20), String(L.ref).padStart(24), ((L.rowsA + L.rowsB) / (2 * L.pairs)).toFixed(1).padStart(10));
