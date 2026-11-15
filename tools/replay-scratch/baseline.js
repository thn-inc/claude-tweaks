// Baseline for archived review runs: recorded finding outcomes, lens/tiebreak agent cost, and the commit the review examined.
// usage: node baseline.js <repo> <run-dir> [<run-dir>...]   -> one JSON line per run
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [repo, ...dirs] = process.argv.slice(2);
const git = (...a) => { try { return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
for (const dir of dirs) {
  const r = { run: path.basename(dir), dir, confirmed: [], refuted: [], other: [], lensAgents: [], tiebreakAgents: [], head: null, base: null, why: [] };
  let text = ''; try { text = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'); } catch { r.why.push('no decisions.md'); }
  const single = new Map(), fixCommits = [];
  for (const line of text.split('\n')) {
    const lens = (line.match(/lens "?(3[a-j])"?/) || [])[1];
    const loc = (line.match(/finding ([^\s]+:\d+)/) || [])[1];
    const m = line.match(/Step 3 Routing: applied .*\(commit ([0-9a-f]{7,40})\)/); if (m) fixCommits.push(m[1]);
    if (!lens || !loc) continue;
    const key = lens + ' ' + loc;
    if (/Reproduction:.* reproduced[.,]/.test(line) && !/not reproduced/.test(line)) r.confirmed.push({ lens, loc, how: 'pair' });
    else if (/not reproduced/.test(line) && !/Console item/.test(line)) single.set(key, { lens, loc });
    else if (/confirmed by tiebreak/.test(line)) { r.confirmed.push({ lens, loc, how: 'tiebreak' }); single.delete(key); }
    else if (/refuted by tiebreak/.test(line) && !/Console item/.test(line)) { r.refuted.push({ lens, loc }); single.delete(key); }
  }
  r.other = [...single.values()];
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
    for (const x of (t.dispatches && t.dispatches.items) || []) {
      const d = x.description || '';
      const rec = { d: d.slice(0, 50), model: x.transcriptModel, out: x.tokens.output, cr: x.tokens.cacheRead, cc: x.tokens.cacheCreate, s: Math.round(x.wallClockMs / 1000) };
      if (/^(Review )?[Ll]ens 3[a-j]/.test(d)) r.lensAgents.push({ ...rec, lens: (d.match(/3[a-j]/) || [])[0] });
      else if (/^Tiebreak/i.test(d)) r.tiebreakAgents.push(rec);
    }
  } catch { r.why.push('no timing.json'); }
  // review head = parent of the earliest review fix commit
  const known = fixCommits.map(c => ({ c, ts: Number(git('log', '-1', '--format=%ct', c)) })).filter(x => x.ts).sort((a, b) => a.ts - b.ts);
  if (known.length) { r.head = git('rev-parse', known[0].c + '^'); r.fixCommit = known[0].c; }
  else r.why.push(fixCommits.length ? 'fix commit not in object store' : 'no fix commit logged');
  if (r.head) r.base = git('merge-base', r.head, 'origin/main');
  r.hasBundle = fs.existsSync(path.join(dir, 'review-ctx', 'context.md'));
  if (!r.hasBundle) r.why.push('no review-ctx/context.md');
  const lensSet = [...new Set(r.lensAgents.map(a => a.lens))].sort();
  r.lenses = lensSet; r.paired = lensSet.length && r.lensAgents.length === 2 * lensSet.length;
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  r.cost = { lensOut: sum(r.lensAgents, 'out'), lensCc: sum(r.lensAgents, 'cc'), lensCr: sum(r.lensAgents, 'cr'), tbOut: sum(r.tiebreakAgents, 'out'), tbCc: sum(r.tiebreakAgents, 'cc'), tbCr: sum(r.tiebreakAgents, 'cr'), agents: r.lensAgents.length + r.tiebreakAgents.length, agentSeconds: sum(r.lensAgents, 's') + sum(r.tiebreakAgents, 's') };
  r.usable = !!(r.head && r.hasBundle && r.paired && (r.confirmed.length + r.refuted.length) > 0);
  console.log(JSON.stringify(r));
}
