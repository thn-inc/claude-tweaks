'use strict';
// tools/review-replay/reviews-extract.js — picks the archived lens-reviewer dispatches a replay can rerun and writes
// everything the replay workflow needs: one clean two-commit repository per run and range, each slot's rewritten
// context bundle, spec and procedure copies beside it, one prompt per arm and slot (the archived prompt with every
// archived sha, worktree and main-checkout path rewritten), the manifest, the fixture recording what was selected and
// why, and the archived reports the scorer compares to. A control arm per archived (tier, effort) reruns the slots at
// the tier and effort they were archived at. No archived reply text or decisions.md verdict line reaches a prompt, a
// repository or a copy; archived-reports.json keeps only each row's severity, path and line. The branch roles (task,
// whole-branch) select their slots in reviews-branch.js and share the rendering, barrier and writes here.

const os = require('os');
const path = require('path');
const { readRun, selectRuns, parseDecisions, LENS_ID, LENS_RE, SIDE_RE } = require('./archive.js');
const { parseArm, positiveInt, isEmptyOrAbsent, writeJson } = require('./extract.js');
const { parseFindings, lastAssistantText, indexTranscripts } = require('./counterfactual.js');
const { stripTree, transcriptEffort, parseLines, messageText } = require('./score.js');
const {
  scanView, rangeOf, originRefsOf, runInputsOf, worktreePathsOf, stripEffortLines, rewriteText, unrewrittenPaths,
} = require('./reviews-rewrite.js');
const { parseLensReport, lensIdOf } = require('../pipeline-cost-report/reviews.js');
const { bump } = require('./util.js');
const {
  SCHEMA_VERSION, REVIEWS_MANIFEST_FILE, REVIEWS_FIXTURE_FILE, REPORTS_FILE, REVIEWS_KIND, CONTROL_ARM, isControlArm, toPosix,
  REVIEW_EXCLUSION_REASONS,
} = require('./schema.js');

const EXIT_SHORTFALL = 3;
const REMOVED = '[run-directory path removed]';
const LENS_ARG = new RegExp(`^${LENS_ID}$`);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// What a --role replays. The lens row: which timing.json items are its dispatches, and the { lens, side } slot each one
// fills. A branch row (`kind: 'branch'`) is selected by reviews-branch.js under its `key`.
const ROLES = {
  lens: {
    kind: 'lens',
    // A headless worker (`kind: 'worker'`, #6000) has no subagent transcript to replay from.
    isDispatch: (item) => item.role === 'lens reviewer' && item.kind !== 'worker',
    slotOf: (item) => {
      const desc = String(item.description || '');
      const lens = LENS_RE.exec(desc);
      const side = SIDE_RE.exec(desc);
      return lens && side ? { lens: lensIdOf(lens[1]), side: side[1].toLowerCase() } : null;
    },
  },
  task: { kind: 'branch', key: 'task' },
  'whole-branch': { kind: 'branch', key: 'whole-branch' },
  'task-vs-branch': { kind: 'branch', key: 'task-vs-branch' },
};

// The options parseArgs collected -> the validated request, or { error } for a malformed invocation.
function parseReviewsOptions(opts, profiles, efforts) {
  if (!hasOwn(ROLES, opts.role)) return { error: `--role must be one of ${Object.keys(ROLES).join('|')}: "${opts.role}"` };
  if (ROLES[opts.role].kind !== 'lens') {
    for (const flag of ['lens', 'max-per-lens']) if (opts[flag] !== undefined) return { error: `--${flag} applies to --role lens only` };
  }
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

// The barrier's `exists` predicate: whether a checkout prefix a text names (`/…/.claude/worktrees`, `~/…`) exists on
// this machine, memoised per prefix since every slot of a run carries the same paths.
function existsOnDisk(fs) {
  const seen = new Map();
  return (prefix) => {
    if (!seen.has(prefix)) {
      const p = prefix.startsWith('~/') ? path.join(os.homedir(), prefix.slice(2)) : prefix;
      let found = true;
      try {
        fs.statSync(p);
      } catch (e) {
        // Only a path that is absent is absent: an unreadable one (EACCES, EIO) may exist, so the barrier flags it.
        found = !(e && isAbsent(e));
      }
      seen.set(prefix, found);
    }
    return seen.get(prefix);
  };
}

// A file or directory that is simply not there, as opposed to one that could not be read.
const isAbsent = (e) => e.code === 'ENOENT' || e.code === 'ENOTDIR';

// The run's dispatches as { dispatches: [{ item, member }], problems }: its own timing.json items (member null), then
// each spec-* member's, deduplicated by agentId in file order. `problems` lists what dropped dispatches without a
// reader seeing them, each { member, reason } (with `index` for an item that is not an object): a listing or a
// timing.json that cannot be read or parsed, one with no `dispatches.items` array, and a run's own absent timing.json.
function dispatchesOf(dir, fs) {
  const problems = [];
  let members = [];
  try {
    // spec-2 before spec-10: by member number, not by name.
    members = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^spec-\d+$/.test(e.name)).map((e) => e.name)
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  } catch (e) {
    members = [];
    if (!isAbsent(e)) problems.push({ member: null, reason: 'timing-unreadable' });
  }
  const seen = new Set();
  const dispatches = [];
  for (const member of [null, ...members]) {
    let timing;
    try {
      timing = JSON.parse(fs.readFileSync(path.join(dir, member || '', 'timing.json'), 'utf8'));
    } catch (e) {
      if (!isAbsent(e)) problems.push({ member, reason: 'timing-unreadable' });
      else if (member === null) problems.push({ member, reason: 'no-timing' });
      continue;
    }
    if (!(timing && timing.dispatches && Array.isArray(timing.dispatches.items))) {
      problems.push({ member, reason: 'timing-unreadable' });
      continue;
    }
    timing.dispatches.items.forEach((item, index) => {
      if (item === null || typeof item !== 'object') {
        problems.push({ member, index, reason: 'timing-unreadable' });
        return;
      }
      if (item.agentId != null) {
        if (seen.has(item.agentId)) return;
        seen.add(item.agentId);
      }
      dispatches.push({ item, member });
    });
  }
  return { dispatches, problems };
}

// The first user message's text, or null when the transcript has none.
function promptOf(transcriptText) {
  const first = parseLines(transcriptText).find((e) => e && e.type === 'user');
  const text = first ? messageText(first.message) : '';
  return text ? text : null;
}

// An archived dispatch's transcript and first user message -> { file, transcript, prompt }: `file` is undefined when
// its agentId has no indexed transcript; `transcript` is null when there is none or it cannot be read, and `prompt` is
// null then or when the transcript holds no user message.
function transcriptPromptOf(item, c, fs) {
  const file = item.agentId != null ? c.transcripts.get(item.agentId) : undefined;
  let transcript = null;
  try {
    transcript = file === undefined ? null : fs.readFileSync(file, 'utf8');
  } catch {
    transcript = null;
  }
  return { file, transcript, prompt: transcript === null ? null : promptOf(transcript) };
}

// The archived reply with every worktree path the prompt names, then the main checkout, stripped, read through
// scanView. Stripped before any parse: a location regex cannot match across the space in a root like `main checkout`.
const strippedReply = (reply, prompt, mainRoot) => [...worktreePathsOf(prompt, { mainRoot }), mainRoot].reduce((t, root) => stripTree(t, root), scanView(reply));

// The archived reply's rows with every worktree path the prompt names, then the main checkout, stripped from the
// paths they cite, so a row cited by absolute path is stored repo-relative. Read through scanView, as the worktree
// paths are, so a win32 citation spelled with `\` strips too and its row path is `/`-separated.
function archivedRows(reply, prompt, mainRoot) {
  const parsed = parseFindings(strippedReply(reply, prompt, mainRoot));
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

// One run input's text, from the run's directory; for a run read from `{runs}/archive/{run}`, an input absent there is
// read from `{runs}/{run}`, where an archived run keeps its `work/`. Throws when neither holds it (run-input-gone).
function readRunInput(r, i, fs) {
  const own = path.join(r.dir, i.member || '', i.rel);
  try {
    return fs.readFileSync(own, 'utf8');
  } catch (e) {
    const archive = path.dirname(r.dir);
    if (path.basename(archive) !== 'archive') throw e;
    return fs.readFileSync(path.join(path.dirname(archive), path.basename(r.dir), i.member || '', i.rel), 'utf8');
  }
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
// reply parses (check 4), whatever happens to the dispatch after. `unitKey`, set with `slot`, is the unit the
// dispatch reviewed: the one its prompt's run-directory paths name, else the spec-{N} member (`member`) whose
// timing.json listed it, else the run.
function examineDispatch(r, item, c, deps, member) {
  const fs = deps.fs;
  const slot = c.role.slotOf(item);
  if (!slot) return { reason: 'unlabelled-dispatch' };
  let unitKey = member ? `${r.run}/${member}` : r.run;
  const tier = item.tier;
  if (typeof tier !== 'string' || !hasOwn(c.PROFILES, tier)) return { slot, unitKey, reason: 'no-archived-tier' };
  const { file, transcript, prompt } = transcriptPromptOf(item, c, fs);
  if (prompt === null) return { slot, unitKey, reason: 'no-transcript' };
  const { inputs, unknown } = runInputsOf(prompt, { mainRoot: c.mainRoot, runName: r.run });
  unitKey = unitOf(r, inputs).key;
  const reply = lastAssistantText(file, fs);
  const counts = reply === null ? null : parseLensReport(reply);
  if (counts === null) return { slot, unitKey, reason: 'report-unparsed' };
  const rows = archivedRows(reply, prompt, c.mainRoot);

  const range = rangeOf(prompt);
  const sides = [range.base || r.base, range.head || r.head];
  if (sides.some((s) => !s)) return { slot, unitKey, rows, reason: 'no-sha-range' };
  const resolved = [];
  for (const sha of sides) {
    try {
      resolved.push(String(deps.git(['rev-parse', '--verify', `${sha}^{commit}`])).trim());
    } catch {
      return { slot, unitKey, rows, reason: 'commit-not-in-clone' };
    }
  }
  if (unknown.length > 0) return { slot, unitKey, rows, reason: 'unknown-run-input' };
  for (const i of inputs) {
    if (i.kind === 'scratch') continue;
    try {
      i.source = readRunInput(r, i, fs);
    } catch {
      return { slot, unitKey, rows, reason: 'run-input-gone' };
    }
  }
  const effort = transcriptEffort(transcript).effort;
  return {
    slot,
    unitKey,
    rows,
    candidate: {
      ...slot, run: r, agentId: item.agentId, prompt, inputs, counts, rows,
      archivedBase: resolved[0], archivedHead: resolved[1], promptBase: resolved[0], promptHead: resolved[1], archivedTier: tier,
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
  const c = {
    role, PROFILES, EFFORT_SCALE, mainRoot: path.resolve(opts.runs, '..', '..'), transcripts: indexTranscripts(opts.transcripts, fs).files,
    exists: existsOnDisk(fs), out, arms,
    // task-vs-branch: the task reviews that are not a Needs fixes with a Critical or Important item (no slot, no row).
    ...(role.key === 'task-vs-branch' ? { notQualifying: 0 } : {}),
  };
  // Required here, not at the top: reviews-branch.js requires this module's helpers at its own top level.
  const branch = role.kind === 'branch' ? require('./reviews-branch.js') : null;
  const excluded = [];
  // Every exclusion row goes through here, so a reason the schema does not list fails loudly instead of shipping.
  const exclude = (row) => {
    if (!REVIEW_EXCLUSION_REASONS.includes(row.reason)) throw new Error(`unknown exclusion reason: ${row.reason}`);
    excluded.push(row);
  };
  const runRows = {};
  const passed = [];
  // Per (unit, lens, side), how many labelled dispatches so far, excluded ones included: a dispatch after the first
  // is a re-review of a later head.
  const ordinals = new Map();
  // Newest run first, by name in code-unit order, whatever order --select named them in.
  const byNewest = [...selected.dirs].sort((a, b) => {
    const x = path.basename(a);
    const y = path.basename(b);
    if (x === y) return 0;
    return x < y ? 1 : -1;
  });
  for (const dir of byNewest) {
    if (branch) {
      // decisions.md is a lens input only, so a branch role reads no run record beyond its dispatches.
      const r = { run: path.basename(dir), dir };
      const found = dispatchesOf(dir, fs);
      for (const { member, index, reason } of found.problems) {
        exclude({ run: r.run, ...(member ? { member } : {}), ...(index != null ? { index } : {}), reason });
      }
      passed.push(...branch.selectBranchSlots(r, found.dispatches, c, deps, exclude));
      continue;
    }
    const r = readRun(dir, deps);
    if (r.excluded) {
      exclude({ run: r.run, reason: r.excluded });
      continue;
    }
    const names = new Map();
    const found = dispatchesOf(dir, fs);
    for (const { member, index, reason } of found.problems) {
      exclude({ run: r.run, ...(member ? { member } : {}), ...(index != null ? { index } : {}), reason });
    }
    for (const { item, member } of found.dispatches.filter((d) => role.isDispatch(d.item))) {
      const x = examineDispatch(r, item, c, deps, member);
      if (x.rows) (runRows[r.run] || (runRows[r.run] = [])).push(...x.rows.map((row) => ({ lens: x.slot.lens, path: row.path, line: row.line })));
      let ordinal = null;
      if (x.slot) {
        const unitSide = `${x.unitKey}\0${x.slot.lens}-${x.slot.side}`;
        ordinal = (ordinals.get(unitSide) || 0) + 1;
        ordinals.set(unitSide, ordinal);
      }
      let reason = x.reason;
      if (!reason) {
        const s = x.candidate;
        const key = `${s.lens}-${s.side}`;
        const k = (names.get(key) || 0) + 1;
        s.name = k === 1 ? key : `${key}.${k}`;
        // Check 8 on the texts as they will be written, but for the archived shas (the replay shas do not exist yet).
        const texts = renderSlot(s, { mainRoot: c.mainRoot, out, repoDir: path.join(out, 'repos', `${r.run}--r0`), shaMap: {}, arms });
        const all = [...texts.copies, ...texts.prompts];
        if (all.some((t) => unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: r.run, outDir: out, exists: c.exists }).length > 0)) reason = 'unrewritten-path';
        else {
          names.set(key, k);
          s.ordinal = ordinal;
          passed.push(s);
        }
      }
      if (reason) {
        exclude({
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
  // The lens role counts slots per lens; task and whole-branch per archived tier; task-vs-branch counts task reviews
  // (its task-head slots) per task-review tier, each beside its final-head control slot.
  const by = {};
  let totals;
  if (role.key === 'task-vs-branch') {
    const heads = slots.filter((s) => s.at === 'task-head');
    for (const s of heads) bump(by, s.taskTier);
    totals = { reviews: heads.length, slots: slots.length, byTaskTier: by, notQualifying: c.notQualifying };
  } else {
    for (const s of slots) bump(by, role.kind === 'lens' ? s.lens : s.archivedTier);
    totals = { reviews: slots.length, [role.kind === 'lens' ? 'byLens' : 'byArchivedTier']: by };
  }
  if (slots.length === 0 || (requested.minReviews !== undefined && totals.reviews < requested.minReviews)) {
    deps.err(JSON.stringify({ shortfall: { requested, available: totals }, excluded }));
    return EXIT_SHORTFALL;
  }

  // Selection succeeded: from here on files are written.
  try {
    return writeOutputs({ out, slots, arms, requested, excluded, totals, runRows, opts, c }, deps);
  } catch (e) {
    deps.err(`review-replay.js: writing ${out} failed: ${String((e && e.message) || e).split('\n')[0]}\nreview-replay.js: ${out} is now partial; remove it before re-running extract-reviews`);
    return 1;
  }
}

function writeOutputs(w, deps) {
  const { out, slots, arms, requested, excluded, totals, runRows, opts, c } = w;
  const fs = deps.fs;
  const { PROFILES } = c;
  const lens = c.role.kind === 'lens';

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
    // The shas the prompt names map to the replay's (for the lens role and --role task, those are the repository's own).
    const shaMap = { [s.promptBase]: s.repo.replayBase, [s.promptHead]: s.repo.replayHead };
    const slotArms = [...userArms, ...controls.filter((a) => a.slots.has(s))];
    const texts = renderSlot(s, { mainRoot: c.mainRoot, out, repoDir: s.repo.dir, shaMap, arms: slotArms });
    // Check 8 ran before the replay shas existed: the texts as written must pass it too, or nothing more is written.
    for (const t of [...texts.copies, ...texts.prompts]) {
      const left = unrewrittenPaths(t.text, { mainRoot: c.mainRoot, runName: s.run.run, outDir: out, exists: c.exists });
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
    if (!lens) {
      reports[name] = {
        role: s.role, run: s.run.run, verdict: s.verdict, items: s.items, itemsUnparsed: s.itemsUnparsed,
        unlocated: s.items.filter((i) => i.path === null).length, taskTier: s.taskTier, at: s.at,
      };
      fixtureSlots.push({
        name, run: s.run.run, role: s.role, agentId: s.agentId, repoKey: s.repo.key, verdict: s.verdict, taskTier: s.taskTier, at: s.at,
        baseFrom: s.baseFrom, taskAgentId: s.taskAgentId, archivedTier: s.archivedTier, archivedEffort: s.archivedEffort, controlArm: s.controlArm,
      });
      continue;
    }
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
  writeJson(fs, path.join(out, REVIEWS_MANIFEST_FILE), { schemaVersion: SCHEMA_VERSION, kind: REVIEWS_KIND, arms: manifestArms });
  writeJson(fs, path.join(out, REVIEWS_FIXTURE_FILE), {
    schemaVersion: SCHEMA_VERSION, role: opts.role, requested, totals, excluded,
    repos: [...repos.values()].map((r) => ({ key: r.key, run: r.run, path: path.join(r.dir, 'repo'), archivedBase: r.archivedBase, archivedHead: r.archivedHead, replayBase: r.replayBase, replayHead: r.replayHead })),
    slots: fixtureSlots,
  });
  writeJson(fs, path.join(out, REPORTS_FILE), lens ? { schemaVersion: SCHEMA_VERSION, reports, confirmed, runRows } : { schemaVersion: SCHEMA_VERSION, reports });
  deps.log(JSON.stringify({ totals, requested, excluded, arms: manifestArms.map((a) => ({ name: a.name, prompts: a.prompts.length })) }, null, 2));
  return 0;
}

module.exports = { extractReviews, ROLES, existsOnDisk, renderSlot, promptOf, transcriptPromptOf, strippedReply, readRunInput };
