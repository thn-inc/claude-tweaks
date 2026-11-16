// Mine every run's decisions.md for the review step's finding outcomes, joined with timing.json review-phase cost.
// usage: node review-yield.js <pipelines-root> [<pipelines-root>...]
const fs = require('fs');
const path = require('path');
const roots = process.argv.slice(2);
const runs = [];
for (const root of roots) for (const base of [root, path.join(root, 'archive')]) {
  let ents; try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
  for (const e of ents) if (e.isDirectory() && e.name !== 'archive') runs.push(path.join(base, e.name));
}
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const out = [];
const unmatched = {};
for (const dir of runs) {
  let text; try { text = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'); } catch { continue; }
  const r = { dir, pairConfirmed: 0, single: 0, tbConfirmed: 0, tbRefuted: 0, tbOther: 0, lens: {}, tier: null };
  const singles = new Set(), resolved = new Set();
  for (const line of text.split('\n')) {
    if (!/Reproduction:|Tiebreak |tiebreak:/.test(line)) continue;
    const lens = (line.match(/lens "([^"]+)"/) || [])[1] || '?';
    const loc = (line.match(/finding ([^\s]+:\d+)/) || [])[1] || '';
    const L = r.lens[lens] || (r.lens[lens] = { pair: 0, single: 0, tbC: 0, tbR: 0 });
    if (/Reproduction:.* reproduced\. Confirmed/.test(line) && !/not reproduced/.test(line)) { r.pairConfirmed++; L.pair++; }
    else if (/not reproduced|both staged unconfirmed/.test(line)) { const n = /both staged/.test(line) ? 2 : 1; r.single += n; L.single += n; singles.add(lens + loc); }
    else if (/confirmed by tiebreak/.test(line)) { r.tbConfirmed++; L.tbC++; resolved.add(lens + loc); }
    else if (/refuted by tiebreak|dropped: refuted/.test(line)) { if (/Console item/.test(line)) continue; r.tbRefuted++; L.tbR++; resolved.add(lens + loc); }
    else if (/Tiebreak tiebreak:/.test(line)) { r.tbOther++; add(unmatched, line.replace(/tiebreak:[0-9a-f]+/g, 'tiebreak:ID').replace(/finding \S+/, 'finding X').replace(/Evidence:.*/, '').replace(/^- \w+ [\d:]+ — /, '').slice(0, 110)); }
    else add(unmatched, line.replace(/finding \S+/g, 'finding X').replace(/^- \w+ [\d:]+ — /, '').replace(/\d+/g, 'N').slice(0, 110));
  }
  if (!(r.pairConfirmed + r.single + r.tbConfirmed + r.tbRefuted)) continue;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
    const p = (t.phases || []).find(x => x.phase === 'review');
    if (p && p.tokens && p.tokens.output) r.review = { min: p.minutes, out: p.tokens.output, cr: p.tokens.cacheRead, cc: p.tokens.cacheCreate, subagents: p.subagents, procBytes: p.procedureBytes };
  } catch { /* no timing */ }
  try { const c = fs.readFileSync(path.join(dir, 'config.yml'), 'utf8'); r.tier = (c.match(/review-effort:\s*(\S+)/) || [])[1] || null; r.ceremony = (c.match(/ceremony-profile:\s*(\S+)/) || [])[1] || null; r.pr = (c.match(/pr(?:-number)?:\s*#?(\d+)/) || [])[1] || null; } catch { /* none */ }
  out.push(r);
}
const sum = k => out.reduce((s, r) => s + r[k], 0);
console.log('run dirs scanned', runs.length, '| runs with review finding outcomes', out.length);
const raised = sum('pairConfirmed') + sum('single');
console.log('findings raised', raised, '| confirmed because both paired reviewers reported it', sum('pairConfirmed'), (100 * sum('pairConfirmed') / raised).toFixed(1) + '%', '| reported by one reviewer only', sum('single'));
console.log('tiebreak verdicts: confirmed', sum('tbConfirmed'), '| refuted', sum('tbRefuted'), '| other', sum('tbOther'), '| refute rate', (100 * sum('tbRefuted') / (sum('tbConfirmed') + sum('tbRefuted'))).toFixed(1) + '%');
const lens = {};
for (const r of out) for (const [k, v] of Object.entries(r.lens)) { const o = lens[k] || (lens[k] = { pair: 0, single: 0, tbC: 0, tbR: 0 }); for (const f of Object.keys(o)) o[f] += v[f]; }
console.log('\nlens   pair-confirmed  single-reporter  tiebreak-confirmed  tiebreak-refuted  pair-agreement%  tiebreak-refute%');
for (const [k, o] of Object.entries(lens).sort((a, b) => (b[1].pair + b[1].single) - (a[1].pair + a[1].single)).slice(0, 14))
  console.log(k.padEnd(8), String(o.pair).padStart(12), String(o.single).padStart(16), String(o.tbC).padStart(19), String(o.tbR).padStart(17), ((100 * o.pair / (o.pair + o.single || 1)).toFixed(0) + '%').padStart(16), ((100 * o.tbR / (o.tbC + o.tbR || 1)).toFixed(0) + '%').padStart(17));
const withCost = out.filter(r => r.review);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log('\nruns with review cost in timing.json:', withCost.length);
if (withCost.length) {
  console.log('median per review: minutes', med(withCost.map(r => r.review.min)), '| output tokens', med(withCost.map(r => r.review.out)), '| cache-read', med(withCost.map(r => r.review.cr)), '| subagents', med(withCost.map(r => r.review.subagents)), '| procedure bytes', med(withCost.map(r => r.review.procBytes)));
  const conf = withCost.reduce((s, r) => s + r.pairConfirmed + r.tbConfirmed, 0), outTok = withCost.reduce((s, r) => s + r.review.out, 0);
  console.log('confirmed findings in those runs', conf, '| output tokens', outTok, '| output tokens per confirmed finding', Math.round(outTok / conf));
  console.log('median findings per review: raised', med(withCost.map(r => r.pairConfirmed + r.single)), '| confirmed', med(withCost.map(r => r.pairConfirmed + r.tbConfirmed)));
}
console.log('\nunmatched line shapes:'); Object.entries(unmatched).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(String(n).padStart(5), ' ' + k));
fs.writeFileSync(path.join(__dirname, 'review-yield.json'), JSON.stringify(out));
