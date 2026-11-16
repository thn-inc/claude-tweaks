// Score the tiebreak replay: verdict agreement with the archived individual tiebreaks, and cost per arm.
// usage: node score-tb.js <tb-dir> <workflow transcript dir>
const fs = require('fs');
const path = require('path');
const [tb, T] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(tb, 'manifest.json'), 'utf8'));
const base = new Map(), meta = new Map();
for (const m of manifest) for (const v of JSON.parse(fs.readFileSync(path.join(tb, '_verdicts', m.run + '.json'), 'utf8'))) { base.set(v.id, v.baseline); meta.set(v.id, { ...v, run: m.run }); }
const claims = new Map();
for (const m of manifest) for (const f of m.chunks) for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) claims.set(c.id, c);

const started = new Map(), results = [];
for (const l of fs.readFileSync(path.join(T, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const e = JSON.parse(l);
  if (e.type === 'started') started.set(e.agentId, e);
  if (e.type === 'result') results.push(e);
}
const arm = { Batched: new Map(), Individual: new Map() };
const failed = { Batched: 0, Individual: 0 };
for (const r of results) {
  const s = started.get(r.agentId); if (!s) continue;
  const res = typeof r.result === 'string' ? (() => { try { return JSON.parse(r.result); } catch { return null; } })() : r.result;
  if (!res || !Array.isArray(res.verdicts)) { failed[s.phase]++; continue; }
  for (const v of res.verdicts) arm[s.phase].set(v.id, v);
}
function cost(phase) {
  const tot = { agents: 0, reqs: 0, out: 0, cr: 0, cc: 0, seconds: 0, toolErr: 0 };
  for (const [id, s] of started) {
    if (s.phase !== phase) continue;
    const f = path.join(T, `agent-${id}.jsonl`); if (!fs.existsSync(f)) continue;
    const msgs = new Map(); let first = null, last = null;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.timestamp) { const t = Date.parse(e.timestamp); if (!first || t < first) first = t; if (!last || t > last) last = t; }
      if (e.type === 'assistant' && e.message && e.message.id && e.message.usage) { const u = e.message.usage, p = msgs.get(e.message.id) || { out: 0, cr: 0, cc: 0 }; p.out = Math.max(p.out, u.output_tokens || 0); p.cr = Math.max(p.cr, u.cache_read_input_tokens || 0); p.cc = Math.max(p.cc, u.cache_creation_input_tokens || 0); msgs.set(e.message.id, p); }
      if (e.type === 'user' && e.message && Array.isArray(e.message.content)) tot.toolErr += e.message.content.filter(b => b.type === 'tool_result' && b.is_error).length;
    }
    tot.agents++; tot.seconds += Math.round(((last - first) || 0) / 1000);
    for (const p of msgs.values()) { tot.reqs++; tot.out += p.out; tot.cr += p.cr; tot.cc += p.cc; }
  }
  return tot;
}
function compare(name, got, ids) {
  const cm = {}; let agree = 0, n = 0, missing = 0; const dis = [];
  for (const id of ids) {
    const v = got.get(id); if (!v) { missing++; continue; }
    n++; const b = base.get(id); const k = b + ' -> ' + v.verdict; cm[k] = (cm[k] || 0) + 1;
    if (b === v.verdict) agree++; else dis.push({ id, b, v });
  }
  console.log(`\n== ${name}: ${n} verdicts returned of ${ids.length} (missing ${missing}) | agree with archived verdict ${agree}/${n} = ${(100 * agree / (n || 1)).toFixed(0)}%`);
  console.log('   archived -> replay:', JSON.stringify(cm));
  return dis;
}
const allIds = [...base.keys()];
const ctlIds = allIds.filter(id => arm.Individual.has(id) || manifest.find(m => m.run === meta.get(id).run).singles.length);
const disB = compare('BATCHED arm, all 9 reviews', arm.Batched, allIds);
compare('BATCHED arm, the 2 control reviews only', arm.Batched, ctlIds);
const disI = compare('INDIVIDUAL arm (rerun noise), 2 control reviews', arm.Individual, ctlIds);
let same = 0, both = 0;
for (const id of ctlIds) { const a = arm.Batched.get(id), b = arm.Individual.get(id); if (a && b) { both++; if (a.verdict === b.verdict) same++; } }
console.log(`\nbatched vs individual replay on the same findings: ${same}/${both} agree`);
const cb = cost('Batched'), ci = cost('Individual');
const bl = manifest.reduce((s, m) => ({ agents: s.agents + m.baselineTiebreakAgents, out: s.out + m.baselineTbOut, cc: s.cc + m.baselineTbCc, cr: s.cr + m.baselineTbCr, seconds: s.seconds + m.baselineTbSeconds }), { agents: 0, out: 0, cc: 0, cr: 0, seconds: 0 });
console.log('\n== cost ==');
console.log('archived individual tiebreaks, 9 reviews:', JSON.stringify(bl), '| findings scored', allIds.length);
console.log('batched replay, same 9 reviews:          ', JSON.stringify(cb), '| failed agents', failed.Batched);
console.log('individual replay, 2 reviews (14 findings):', JSON.stringify(ci), '| failed agents', failed.Individual);
console.log('\n== batched disagreements with archived verdicts ==');
for (const d of disB) { const m = meta.get(d.id), c = claims.get(d.id); const ind = arm.Individual.get(d.id);
  console.log(`- ${m.run.slice(-9)} ${m.lens} ${m.loc} [${m.severity}] archived=${d.b} batched=${d.v.verdict}${ind ? ' individual-replay=' + ind.verdict : ''}\n    claim: ${c.claim.slice(0, 230)}\n    batched reason: ${String(d.v.reason).slice(0, 260)}\n    evidence: ${String(d.v.evidence).slice(0, 200)}`); }
console.log('\n== individual-replay disagreements with archived verdicts ==');
for (const d of disI) { const m = meta.get(d.id); console.log(`- ${m.run.slice(-9)} ${m.lens} ${m.loc} archived=${d.b} individual=${d.v.verdict} batched=${(arm.Batched.get(d.id) || {}).verdict}: ${String(d.v.reason).slice(0, 200)}`); }
