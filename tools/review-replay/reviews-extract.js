'use strict';
// tools/review-replay/reviews-extract.js — picks the archived lens-reviewer dispatches a replay can rerun and writes
// everything the replay workflow needs: one clean two-commit repository per run and range, each slot's rewritten
// context bundle, spec and procedure copies beside it, one prompt per arm and slot (the archived prompt with every
// archived sha, worktree and main-checkout path rewritten), the manifest, the fixture recording what was selected and
// why, and the archived reports the scorer compares to. A control arm per archived (tier, effort) reruns the slots at
// the tier and effort they were archived at. No archived reply text or decisions.md verdict line reaches a prompt, a
// repository or a copy; archived-reports.json keeps only each row's severity, path and line.

const path = require('path');
const { readRun, selectRuns, parseDecisions, LENS_ID, LENS_RE, SIDE_RE } = require('./archive.js');
const { parseArm, positiveInt, isEmptyOrAbsent, writeJson } = require('./extract.js');
const { parseFindings, lastAssistantText, indexTranscripts } = require('./counterfactual.js');
const { stripTree, transcriptEffort, parseLines, messageText } = require('./score.js');
const {
  rangeOf, originRefsOf, runInputsOf, worktreePathsOf, stripEffortLines, rewriteText, unrewrittenPaths,
} = require('./reviews-rewrite.js');
const { parseLensReport, lensIdOf } = require('../pipeline-cost-report/reviews.js');
const { bump } = require('./util.js');
const {
  SCHEMA_VERSION, REVIEWS_MANIFEST_FILE, REVIEWS_FIXTURE_FILE, REPORTS_FILE, REVIEWS_KIND, CONTROL_ARM, isControlArm, toPosix,
} = require('./schema.js');

const EXIT_SHORTFALL = 3;
const REMOVED = '[run-directory path removed]';
const LENS_ARG = new RegExp(`^${LENS_ID}$`);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// What a --role replays: which timing.json items are its dispatches, and the { lens, side } slot each one fills.
const ROLES = {
  lens: {
    isDispatch: (item) => item.role === 'lens reviewer',
    slotOf: (item) => {
      const desc = String(item.description || '');
      const lens = LENS_RE.exec(desc);
      const side = SIDE_RE.exec(desc);
      return lens && side ? { lens: lensIdOf(lens[1]), side: side[1].toLowerCase() } : null;
    },
  },
};

// The options parseArgs collected -> the validated request, or { error } for a malformed invocation.
function parseReviewsOptions(opts, profiles, efforts) {
  if (!hasOwn(ROLES, opts.role)) return { error: `--role must be one of ${Object.keys(ROLES).join('|')}: "${opts.role}"` };
  if (!opts.arms || opts.arms.length === 0) return { error: 'extract-reviews requires at least one --arm' };
  const arms = [];
  for (const text of opts.arms) {
    const parsed = parseArm(text, profiles, efforts);
    if (parsed.error) return parsed;
    const { chunk, ...arm } = parsed.arm;
    if (chunk !== 1) return { error: '--arm: chunk does not apply to extract-reviews' };
    if (isControlArm(arm.name)) return { error: `--arm: "${arm.name}" is reserved for the control arm` };
    if (arms.some((a) => a.name === arm.name)) return { error: `--arm: duplicate arm name "${arm.name}"` };
    arms.push(arm);
  }
  const requested = {};
  if (opts.lens !== undefined) {
    // A lens is named as the slots name it: `3b`, `3b Security` and `security` are all 3b.
    const lenses = String(opts.lens).split(',').map((s) => s.trim()).filter(Boolean).map(lensIdOf);
    const bad = lenses.find((l) => !LENS_ARG.test(l));
    if (lenses.length === 0 || bad !== undefined) return { error: `--lens must be lens ids (${LENS_ID}), comma-separated: "${opts.lens}"` };
    requested.lens = lenses;
  }
  for (const [flag, key] of [['max-per-lens', 'maxPerLens'], ['min-reviews', 'minReviews']]) {
    if (opts[flag] === undefined) continue;
    const n = positiveInt(`--${flag}`, opts[flag]);
    if (n.error) return n;
    requested[key] = n.value;
  }
  return { role: ROLES[opts.role], arms, requested };
}

function readJsonOrNull(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The run's dispatches: its own timing.json items, then each spec-* member's, deduplicated by agentId in file order.
function dispatchesOf(dir, fs) {
  let members = [];
  try {
    // spec-2 before spec-10: by member number, not by name.
    members = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^spec-\d+$/.test(e.name)).map((e) => e.name)
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  } catch {
    members = [];
  }
  const seen = new Set();
  const out = [];
  for (const file of [path.join(dir, 'timing.json'), ...members.map((m) => path.join(dir, m, 'timing.json'))]) {
    const timing = readJsonOrNull(fs, file);
    const items = timing && timing.dispatches && Array.isArray(timing.dispatches.items) ? timing.dispatches.items : [];
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;
      if (item.agentId != null) {
        if (seen.has(item.agentId)) continue;
        seen.add(item.agentId);
      }
      out.push(item);
    }
  }
  return out;
}

// The first user message's text, or null when the transcript has none.
function promptOf(transcriptText) {
  const first = parseLines(transcriptText).find((e) => e && e.type === 'user');
  const text = first ? messageText(first.message) : '';
  return text ? text : null;
}

// The archived reply's rows with every worktree path the prompt names, then the main checkout, stripped from the
// paths they cite, so a row cited by absolute path is stored repo-relative.
function archivedRows(reply, prompt, mainRoot) {
  const stripped = [...worktreePathsOf(prompt, { mainRoot }), mainRoot].reduce((t, root) => stripTree(t, root), reply);
  const parsed = parseFindings(stripped);
  return parsed ? parsed.rows.map(({ sev, path: p, line }) => ({ sev, path: p, line })) : [];
}

// A slot's unit: the spec-{N} member every run-directory path of its prompt names, else the run itself.
function unitOf(r, inputs) {
  const members = new Set(inputs.map((i) => i.member));
  const member = members.size === 1 ? [...members][0] : null;
  return member ? { key: `${r.run}/${member}`, dir: path.join(r.dir, member) } : { key: r.run, dir: r.dir };
}

// The findings decisions.md confirmed for one lens of a unit: reproduced pairs and tiebreak-confirmed verdicts. A unit
// with no readable decisions.md (a member's; readRun already required the run's own) has none, and says so in
// `confirmedSource: 'missing'`, so an empty list there is never read as a review that confirmed nothing.
function confirmedOf(unitDir, lens, fs) {
  let text;
  try {
    text = fs.readFileSync(path.join(unitDir, 'decisions.md'), 'utf8');
  } catch {
    return { findings: [], unlocated: 0, confirmedSource: 'missing' };
  }
  const d = parseDecisions(text);
  const all = [
    ...d.pairConfirmed.filter((p) => lensIdOf(p.lens) === lens).map((p) => ({ path: p.path, line: p.line, how: 'pair' })),
    ...d.verdicts.filter((v) => v.verdict === 'confirmed' && lensIdOf(v.lens) === lens).map((v) => ({ path: v.path, line: v.line, how: 'tiebreak' })),
  ];
  const findings = all.filter((f) => Number.isFinite(f.line));
  return { findings, unlocated: all.length - findings.length };
}

const inputKey = (i) => `${i.member ? `${i.member}/` : ''}${i.rel}`;

// One slot's texts: its copies (bundle, spec, procedure) beside the repository and its prompt per arm, every one
// rewritten. `repoDir` holds the repository (`repoDir/repo`) and the copies.
function renderSlot(s, { mainRoot, out, repoDir, shaMap, arms }) {
  const runName = s.run.run;
  const repoPath = toPosix(path.join(repoDir, 'repo'));
  const copyPath = new Map();
  const taken = new Set();
  for (const i of s.inputs) {
    if (i.kind === 'scratch' || copyPath.has(inputKey(i))) continue;
    const base = i.kind === 'bundle' ? 'context.md' : path.posix.basename(i.rel);
    let name = `${s.name}--${base}`;
    for (let n = 2; taken.has(name); n += 1) name = `${s.name}--${n}-${base}`;
    taken.add(name);
    copyPath.set(inputKey(i), { file: path.join(repoDir, name), source: i.source });
  }
  const copies = [];
  for (const { file, source } of copyPath.values()) {
    const { inputs, unknown } = runInputsOf(source, { mainRoot, runName, copy: true });
    // A path the copy names that is no input of this slot never stays live: decisions.md, another run's directory.
    const replacements = Object.fromEntries(unknown.map((u) => [u, REMOVED]));
    for (const c of inputs) {
      const own = c.kind === 'scratch' ? undefined : copyPath.get(inputKey(c));
      replacements[c.match] = own ? toPosix(own.file) : REMOVED;
    }
    copies.push({ file, text: rewriteText(source, { mainRoot, runName, repoPath, replacements, shaMap }) });
  }
  const prompts = arms.map((arm) => {
    const scratchRoot = path.join(out, 'scratch', arm.name, runName, s.name);
    const scratchDirs = [];
    const replacements = {};
    for (const i of s.inputs) {
      if (i.kind === 'scratch') {
        const tail = i.rel.slice(i.rel.indexOf('agent-scratch/') + 'agent-scratch/'.length);
        scratchDirs.push(path.join(scratchRoot, tail.split('/')[0]));
        replacements[i.match] = toPosix(path.join(scratchRoot, tail));
      } else {
        replacements[i.match] = toPosix(copyPath.get(inputKey(i)).file);
      }
    }
    const text = rewriteText(stripEffortLines(s.prompt), { mainRoot, runName, repoPath, replacements, shaMap });
    return { arm: arm.name, file: path.join(out, 'prompts', arm.name, runName, `${s.name}.md`), text, scratchDirs };
  });
  return { copies, prompts };
}

// One lens dispatch of a run -> { reason } (the first check it fails) or { slot }. `rows` is set once its archived
// reply parses (check 4), whatever happens to the dispatch after.
function examineDispatch(r, item, c, deps) {
  const fs = deps.fs;
  const slot = c.role.slotOf(item);
  if (!slot) return { reason: 'unlabelled-dispatch' };
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { slot, reason: 'no-archived-tier' };
  const file = item.agentId != null ? c.transcripts.get(item.agentId) : undefined;
  let transcript = null;
  try {
    transcript = file === undefined ? null : fs.readFileSync(file, 'utf8');
  } catch {
    transcript = null;
  }
  const prompt = transcript === null ? null : promptOf(transcript);
  if (prompt === null) return { slot, reason: 'no-transcript' };
  const reply = lastAssistantText(file, fs);
  const counts = reply === null ? null : parseLensReport(reply);
  if (counts === null) return { slot, reason: 'report-unparsed' };
  const rows = archivedRows(reply, prompt, c.mainRoot);

  const range = rangeOf(prompt);
  const sides = [range.base || r.base, range.head || r.head];
  if (sides.some((s) => !s)) return { slot, rows, reason: 'no-sha-range' };
  const resolved = [];
  for (const sha of sides) {
    try {
      resolved.push(String(deps.git(['rev-parse', '--verify', `${sha}^{commit}`])).trim());
    } catch {
      return { slot, rows, reason: 'commit-not-in-clone' };
    }
  }
  const { inputs, unknown } = runInputsOf(prompt, { mainRoot: c.mainRoot, runName: r.run });
  if (unknown.length > 0) return { slot, rows, reason: 'unknown-run-input' };
  for (const i of inputs) {
    if (i.kind === 'scratch') continue;
    try {
      i.source = fs.readFileSync(path.join(r.dir, i.member || '', i.rel), 'utf8');
    } catch {
      return { slot, rows, reason: 'run-input-gone' };
    }
  }
  const effort = transcriptEffort(transcript).effort;
  return {
    slot,
    rows,
    candidate: {
      ...slot, run: r, agentId: item.agentId, prompt, inputs, counts, rows,
      archivedBase: resolved[0], archivedHead: resolved[1], archivedTier: tier,
      archivedEffort: c.EFFORT_SCALE.includes(effort) ? effort : c.PROFILES[tier].effort,
      originRefs: originRefsOf(prompt),
    },
  };
}

function extractReviews(opts, deps) {
  const fs = deps.fs;
  const { PROFILES, EFFORT_SCALE } = require(path.join(deps.pluginRoot, 'bin', 'lib', 'model-profiles', 'profiles.js'));
  const request = parseReviewsOptions(opts, PROFILES, EFFORT_SCALE);
  if (request.error) {
    deps.err(`review-replay.js: ${request.error}`);
    return 2;
  }
  const { role, arms, requested } = request;
  if (!isEmptyOrAbsent(fs, opts.out)) {
    deps.err(`review-replay.js: --out ${opts.out} must not exist or must be empty`);
    return 2;
  }
  const dup = (opts.select || []).find((n, i, all) => all.indexOf(n) !== i);
  if (dup !== undefined) {
    deps.err(`review-replay.js: --select names run "${dup}" more than once`);
    return 2;
  }
  const selected = selectRuns(opts.runs, opts.select, fs);
  if (selected.missing.length > 0) {
    deps.err(`review-replay.js: no such run under ${opts.runs}: ${selected.missing.join(', ')}`);
    return 2;
  }

  // The runs root is {main checkout}/.claude-tweaks/pipelines.
  const out = path.resolve(opts.out);
  const c = { role, PROFILES, EFFORT_SCALE, mainRoot: path.resolve(opts.runs, '..', '..'), transcripts: indexTranscripts(opts.transcripts, fs).files };
  const excluded = [];
  const runRows = {};
  const passed = [];
  // Per (unit, lens, side), how many slots passed so far: a slot after the first is a re-review of a later head.
  const ordinals = new Map();
  // Newest run first, by name in code-unit order, whatever order --select named them in.
  const byNewest = [...selected.dirs].sort((a, b) => {
    const x = path.basename(a);
    const y = path.basename(b);
    return x < y ? 1 : x > y ? -1 : 0;
  });
  for (const dir of byNewest) {
    const r = readRun(dir, deps);
    if (r.excluded) {
      excluded.push({ run: r.run, reason: r.excluded });
      continue;
    }
    const names = new Map();
    for (const item of dispatchesOf(dir, fs).filter(role.isDispatch)) {
      const x = examineDispatch(r, item, c, deps);
      if (x.rows) (runRows[r.run] || (runRows[r.run] = [])).push(...x.rows.map((row) => ({ lens: x.slot.lens, path: row.path, line: row.line })));
      let reason = x.reason;
      if (!reason) {
        const s = x.candidate;
        const key = `${s.lens}-${s.side}`;
        const k = (names.get(key) || 0) + 1;
        s.name = k === 1 ? key : `${key}.${k}`;
        // Check 8 on the texts as they will be written, but for the archived shas (the replay shas do not exist yet).
        const texts = renderSlot(s, { mainRoot: c.mainRoot, out, repoDir: path.join(out, 'repos', `${r.run}--r0`), shaMap: {}, arms });
        const all = [...texts.copies, ...texts.prompts];
        if (all.some((t) => unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: r.run, outDir: out }).length > 0)) reason = 'unrewritten-path';
        else {
          names.set(key, k);
          const unitSide = `${unitOf(r, s.inputs).key}\0${key}`;
          s.ordinal = (ordinals.get(unitSide) || 0) + 1;
          ordinals.set(unitSide, s.ordinal);
          passed.push(s);
        }
      }
      if (reason) {
        excluded.push({
          run: r.run, ...(item.agentId != null ? { agentId: item.agentId } : {}),
          ...(x.slot ? { lens: x.slot.lens, side: x.slot.side } : {}), reason,
        });
      }
    }
  }

  const perLens = {};
  const slots = passed.filter((s) => {
    if (requested.lens && !requested.lens.includes(s.lens)) return false;
    if (requested.maxPerLens !== undefined && (perLens[s.lens] || 0) >= requested.maxPerLens) return false;
    bump(perLens, s.lens);
    return true;
  });
  const byLens = {};
  for (const s of slots) bump(byLens, s.lens);
  if (slots.length === 0 || (requested.minReviews !== undefined && slots.length < requested.minReviews)) {
    deps.err(JSON.stringify({ shortfall: { requested, available: { reviews: slots.length, byLens } }, excluded }));
    return EXIT_SHORTFALL;
  }

  // Selection succeeded: from here on files are written.
  try {
    return writeOutputs({ out, slots, arms, requested, excluded, byLens, runRows, opts, c }, deps);
  } catch (e) {
    deps.err(`review-replay.js: writing ${out} failed: ${String((e && e.message) || e).split('\n')[0]}\nreview-replay.js: ${out} is now partial; remove it before re-running extract-reviews`);
    return 1;
  }
}

function writeOutputs(w, deps) {
  const { out, slots, arms, requested, excluded, byLens, runRows, opts, c } = w;
  const fs = deps.fs;
  const { PROFILES } = c;

  // One repository per distinct (run, base, head), numbered within the run.
  const repos = new Map();
  const perRun = {};
  for (const s of slots) {
    const id = `${s.run.run}\0${s.archivedBase}\0${s.archivedHead}`;
    if (!repos.has(id)) {
      bump(perRun, s.run.run);
      const key = `${s.run.run}--r${perRun[s.run.run]}`;
      repos.set(id, { key, run: s.run.run, dir: path.join(out, 'repos', key), archivedBase: s.archivedBase, archivedHead: s.archivedHead, originRefs: new Set() });
    }
    s.repo = repos.get(id);
    for (const ref of s.originRefs) s.repo.originRefs.add(ref);
  }

  // One control arm per archived (tier, effort); `control` alone when every slot shares one.
  const groups = new Map();
  for (const s of slots) {
    const id = `${s.archivedTier}\0${s.archivedEffort}`;
    if (!groups.has(id)) groups.set(id, { tier: s.archivedTier, effort: s.archivedEffort, slots: [] });
    groups.get(id).slots.push(s);
  }
  const controls = [...groups.values()].map((g) => {
    const name = groups.size === 1 ? CONTROL_ARM : `${CONTROL_ARM}.${g.tier}.${g.effort === null ? 'none' : g.effort}`;
    for (const s of g.slots) s.controlArm = name;
    return { name, profile: g.tier, model: PROFILES[g.tier].model, effort: g.effort, repeat: 1, prompts: [], slots: new Set(g.slots) };
  });
  const userArms = arms.map((a) => ({
    name: a.name, profile: a.profile, model: PROFILES[a.profile].model, effort: a.effort !== undefined ? a.effort : PROFILES[a.profile].effort, repeat: a.repeat, prompts: [],
  }));

  fs.mkdirSync(out, { recursive: true });
  for (const repo of repos.values()) {
    const replay = deps.writeRepo(repo.archivedBase, repo.archivedHead, path.join(repo.dir, 'repo'), { originRefs: [...repo.originRefs] });
    repo.replayBase = replay.base;
    repo.replayHead = replay.head;
  }

  const reports = {};
  const confirmed = {};
  const fixtureSlots = [];
  for (const s of slots) {
    const shaMap = { [s.archivedBase]: s.repo.replayBase, [s.archivedHead]: s.repo.replayHead };
    const slotArms = [...userArms, ...controls.filter((a) => a.slots.has(s))];
    const texts = renderSlot(s, { mainRoot: c.mainRoot, out, repoDir: s.repo.dir, shaMap, arms: slotArms });
    // Check 8 ran before the replay shas existed: the texts as written must pass it too, or nothing more is written.
    for (const t of [...texts.copies, ...texts.prompts]) {
      const left = unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: s.run.run, outDir: out });
      if (left.length > 0) throw new Error(`${t.file} still names ${left[0]} after its shas were mapped`);
    }
    for (const copy of texts.copies) fs.writeFileSync(copy.file, copy.text);
    const name = `${s.run.run}/${s.name}`;
    const repoPath = path.join(s.repo.dir, 'repo');
    texts.prompts.forEach((p, i) => {
      for (const d of p.scratchDirs) fs.mkdirSync(d, { recursive: true });
      fs.mkdirSync(path.dirname(p.file), { recursive: true });
      fs.writeFileSync(p.file, p.text);
      slotArms[i].prompts.push({ file: p.file, name, run: s.run.run, lens: s.lens, side: s.side, repo: repoPath });
    });
    const unit = unitOf(s.run, s.inputs);
    reports[name] = { lens: s.lens, side: s.side, run: s.run.run, unitKey: unit.key, counts: s.counts, rows: s.rows };
    const byUnit = confirmed[unit.key] || (confirmed[unit.key] = {});
    if (!byUnit[s.lens]) byUnit[s.lens] = confirmedOf(unit.dir, s.lens, fs);
    fixtureSlots.push({
      name, run: s.run.run, unit: unit.key, lens: s.lens, side: s.side, ordinal: s.ordinal, agentId: s.agentId, repoKey: s.repo.key,
      archivedTier: s.archivedTier, archivedEffort: s.archivedEffort, controlArm: s.controlArm,
    });
  }

  const manifestArms = [...userArms, ...controls.map(({ slots: _, ...a }) => a)];
  const totals = { reviews: slots.length, byLens };
  writeJson(fs, path.join(out, REVIEWS_MANIFEST_FILE), { schemaVersion: SCHEMA_VERSION, kind: REVIEWS_KIND, arms: manifestArms });
  writeJson(fs, path.join(out, REVIEWS_FIXTURE_FILE), {
    schemaVersion: SCHEMA_VERSION, role: opts.role, requested, totals, excluded,
    repos: [...repos.values()].map((r) => ({ key: r.key, run: r.run, path: path.join(r.dir, 'repo'), archivedBase: r.archivedBase, archivedHead: r.archivedHead, replayBase: r.replayBase, replayHead: r.replayHead })),
    slots: fixtureSlots,
  });
  writeJson(fs, path.join(out, REPORTS_FILE), { schemaVersion: SCHEMA_VERSION, reports, confirmed, runRows });
  deps.log(JSON.stringify({ totals, requested, excluded, arms: manifestArms.map((a) => ({ name: a.name, prompts: a.prompts.length })) }, null, 2));
  return 0;
}

module.exports = { extractReviews, ROLES };
