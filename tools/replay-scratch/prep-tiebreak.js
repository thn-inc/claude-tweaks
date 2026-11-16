// Prepare the batched-tiebreak replay: for each chosen archived review, extract the reviewed tree and write the
// findings its individual tiebreak agents judged — inputs (no verdicts) for the agents, verdicts kept separately.
// usage: node prep-tiebreak.js <repo> <baseline.ndjson> <out-dir> <chunk-size> <run-substr> [...]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [repo, baselineFile, out, chunkArg, ...want] = process.argv.slice(2);
const CHUNK = Number(chunkArg);
const rows = fs.readFileSync(baselineFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const manifest = [];
for (const w of want) {
  const r = rows.find(x => x.run.includes(w));
  if (!r || !r.usable) { console.log('skip', w, 'not usable'); continue; }
  let claims; try { claims = JSON.parse(fs.readFileSync(path.join(r.dir, 'review-findings.json'), 'utf8')); } catch { console.log('skip', w, 'no review-findings.json'); continue; }
  const text = fs.readFileSync(path.join(r.dir, 'decisions.md'), 'utf8').split('\n');
  const verdictOf = (lens, loc) => {
    for (const line of text) {
      if (/Console item/.test(line) || !line.includes(loc)) continue;
      if (!new RegExp('lens "?' + lens + '"?').test(line)) continue;
      if (/confirmed by tiebreak/.test(line)) return 'confirmed';
      if (/refuted by tiebreak/.test(line)) return 'refuted';
      if (/digested: (verdict:cant-tell|evidence-unverified)/.test(line)) return 'cant-tell';
    }
    return null;
  };
  const items = [];
  for (const c of claims) {
    const v = verdictOf(c.lens, c.path + ':' + c.line);
    if (!v) continue;
    items.push({ id: c.id, lens: c.lens, path: c.path, line: c.line, severity: c.reporterSeverity, claim: c.claim, baseline: v });
  }
  if (items.length < 2) { console.log('skip', w, 'fewer than 2 judged findings'); continue; }
  const dir = path.join(out, r.run);
  const tree = path.join(dir, 'tree');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(tree, { recursive: true });
  const tar = execFileSync('git', ['-C', repo, 'archive', r.head, '--', '.', ':(exclude).claude-tweaks'], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', tree], { input: tar });
  const missing = items.filter(i => !fs.existsSync(path.join(tree, i.path)));
  const usable = items.filter(i => fs.existsSync(path.join(tree, i.path)));
  const chunks = [];
  for (let i = 0; i < usable.length; i += CHUNK) {
    const f = path.join(dir, `chunk-${chunks.length + 1}.json`);
    fs.writeFileSync(f, JSON.stringify(usable.slice(i, i + CHUNK).map(({ baseline, ...rest }) => rest), null, 1));
    chunks.push(f);
  }
  const singles = usable.map(u => { const f = path.join(dir, `single-${u.id}.json`); const { baseline, ...rest } = u; fs.writeFileSync(f, JSON.stringify([rest], null, 1)); return f; });
  fs.mkdirSync(path.join(out, '_verdicts'), { recursive: true });
  fs.writeFileSync(path.join(out, '_verdicts', r.run + '.json'), JSON.stringify(usable.map(u => ({ id: u.id, lens: u.lens, loc: u.path + ':' + u.line, severity: u.severity, baseline: u.baseline }))));
  manifest.push({ run: r.run, tree, chunks, singles, n: usable.length, droppedMissingFile: missing.length, baselineTiebreakAgents: r.tiebreakAgents.length, baselineTbOut: r.cost.tbOut, baselineTbCc: r.cost.tbCc, baselineTbCr: r.cost.tbCr, baselineTbSeconds: r.tiebreakAgents.reduce((s, a) => s + a.s, 0) });
  console.log('ok', r.run, 'findings', usable.length, 'chunks', chunks.length, 'baseline', JSON.stringify(usable.reduce((o, u) => (o[u.baseline] = (o[u.baseline] || 0) + 1, o), {})), 'tiebreak agents', r.tiebreakAgents.length);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('runs', manifest.length, 'findings', manifest.reduce((s, m) => s + m.n, 0), 'chunks', manifest.reduce((s, m) => s + m.chunks.length, 0));
