// plugin/bin/lib/learned-skills/land.js — delivers captured Skills-row patches (#5290).
// `capture` (learned-skills.js) left each edit as a patch file under {runDir}/learned-skills/;
//   land   builds one plumbing commit per patch on refs/heads/learned-skills/{run-id}, pushes it and
//          opens a ready, never-armed PR (no merge call of any kind exists here);
//   stage  writes each captured patch as a staged Review Console proposal (local-merge, no forge).
// Every downgrade goes through learned-skills.js's `stageEntry`, so the staging-time gate and the
// STAGED log line are the one implementation. The worktree's own branch, index and files are never
// touched: commits are built on a temp index (GIT_INDEX_FILE on the plumbing calls' own env), and a
// commit built for an entry that is then staged is simply abandoned (an unreferenced object).
//
// Resume: an entry already `landed` is skipped. The branch's PRs are looked up by head name on every
// land, whether or not the remote branch still exists (a merged PR's branch is deleted on merge). A
// still-captured entry a MERGED PR already shipped (a run that died after the merge, before its
// manifest write) is recorded landed against that PR: one of its commits carries this run's id and the
// entry's id in its trailers, and that commit's own diff has the entry's patch's `git patch-id
// --stable`. Its commits are read through `gh api` (every page, every merged PR on the head name) and
// their objects fetched from refs/pull/{n}/head, never from the deleted branch. A failed PR lookup,
// fetch or commit read fails closed: every remaining entry is staged naming the failed read, and nothing
// is built. With no open PR, the entries a merged PR did not ship are staged naming it.
// An existing remote branch is the base only when its PRs say so: an open PR is reused; no PR ever (a
// crash between push and create) means the branch is this run's own, so it is the base and the PR is
// opened on it. Either way, every commit on it must carry this run's id and the id of a landed or
// still-captured entry in its trailers, and its own diff must have the same patch-id as that entry's
// patch file (a join can rewrite the patch under the same id); otherwise (a failed delete may have left
// staged entries' commits, even behind a PR GitHub opened while create errored) every entry is staged
// with a reason naming the branch and the PR. A closed PR leaves the branch untouched and stages every
// entry with a reason. A captured entry whose verified commit is already on the branch (a run that died
// before its manifest write) reuses it; any other is built and `apply --check` lands or stages it.
// A `captured` entry is `superseded` only when the run branch changed its target after the merge base
// AND its patch reverse-applies to HEAD (capture's bothInTree/stuck outcomes leave the edit in the
// tree for the run branch); any other `captured` entry is delivered.
//
// Every side effect goes through `deps` (git, gh, now, appendEntries, fs seams) so tests inject fakes.
'use strict';

const path = require('path');
const { splitNul } = require('../git-z');
const { formatEntry } = require('../log-decision/append');
const { neutralizeClosingPhrases } = require('../flow/closing-links');
const { GIT_TIMEOUT_MS, GIT_PUSH_TIMEOUT_MS } = require('../shared-primitives');
const {
  UsageError, realDeps, gitEnv, readManifest, writeManifest, skillLabel, stageEntry, headShortReader, LOG_SECTION, STEP, rowLabel, entryFindings, oneLine, firstStderrLine,
} = require('./learned-skills');
const { STATUS, patchDir, localPatchPath } = require('./layout');

const MARKER = '<!-- wrap-up-skills-pr -->';

function normalizeRecords(record) {
  const list = (Array.isArray(record) ? record : [record]).map((r) => String(r == null ? '' : r).replace(/^#/, '').trim());
  if (!list.length || list.some((r) => !/^[1-9]\d*$/.test(r))) throw new UsageError('record must be one or more issue numbers');
  return [...new Set(list)];
}

function checkCommon({ runDir, worktree }) {
  if (typeof runDir !== 'string' || !runDir) throw new UsageError('runDir is required');
  if (typeof worktree !== 'string' || !worktree) throw new UsageError('worktree is required');
}

// Required: it is what lets a captured edit the run branch already carries be recognised.
function checkMergeBase(mergeBase) {
  if (typeof mergeBase !== 'string' || !mergeBase.trim() || mergeBase.startsWith('-')) throw new UsageError('mergeBase must be a commit id');
  return mergeBase;
}

// The manifest, with each captured patch read from the learned-skills/ dir beside it. Its stored
// absolute path goes stale once the run dir is archived, and verify's learned-skills-delivered
// remedy is a land or stage against the archived dir. readManifest has already refused a malformed
// entry (naming the manifest and the entry's index), so every captured entry names a patch.
function readLocalManifest(runDir) {
  const manifest = readManifest(runDir);
  for (const e of manifest) {
    if (e.status === STATUS.CAPTURED) e.patch = localPatchPath(runDir, e.patch);
  }
  return manifest;
}

// Splits the manifest's captured entries into those to deliver and those the run branch already
// carries. An entry is superseded only when the run branch changed its target after the merge base AND
// the entry's patch reverse-applies to HEAD's tree (the edit itself is on the run branch); a target the
// run branch changed some other way is delivered as usual. An entry a staged proposal already holds
// (stagedCopyOf) is marked staged with that path, never staged again. Mutates `manifest` entries for
// the superseded and already-staged ones.
// Throws when the carried check itself cannot run (the temp index, read-tree, or a reverse-apply that
// failed for any reason but refusing the patch): the caller writes no manifest, so every entry stays
// captured and nothing is delivered on a guess.
function triage({ runDir, worktree, mergeBase, manifest, deps }) {
  const captured = manifest.filter((e) => e.status === STATUS.CAPTURED);
  const todo = [];
  const superseded = [];
  const already = [];
  const copies = stagedCopies(runDir, manifest, deps);
  let owned = [];
  if (captured.length) {
    owned = splitNul(deps.git(['-C', worktree, '-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--end-of-options', mergeBase, 'HEAD', '--']));
  }
  const checkIndex = path.join(patchDir(runDir), 'index-check.tmp');
  // true: the patch reverse-applies to HEAD (the run branch carries it); false: git apply refused it
  // (exit 1). Anything else throws, naming the entry.
  const carried = (e) => {
    const env = gitEnv({ GIT_INDEX_FILE: checkIndex });
    const cannot = (err) => new Error(`could not check whether the run branch already carries entry ${e.id} (${e.target}): ${firstStderrLine(err)}; every captured entry stays captured`);
    try {
      deps.mkdir(path.dirname(checkIndex));
      deps.git(['-C', worktree, 'read-tree', '--end-of-options', 'HEAD'], { env });
    } catch (err) { throw cannot(err); }
    try {
      deps.git(['-C', worktree, 'apply', '--cached', '--check', '-R', '--end-of-options', e.patch], { env });
      return true;
    } catch (err) {
      if (err && err.status === 1) return false;
      throw cannot(err);
    }
  };
  try {
    for (const e of captured) {
      if (owned.includes(e.target) && carried(e)) {
        e.status = STATUS.SUPERSEDED;
        e.reason = 'the run branch already carries this edit, so it travels with the record';
        superseded.push({ id: e.id, target: e.target, reason: e.reason });
        continue;
      }
      const copy = stagedCopyOf(e, copies, deps);
      if (copy) {
        e.status = STATUS.STAGED;
        e.stagePath = copy;
        e.reason = 'already staged by an earlier call whose manifest write failed';
        already.push({ id: e.id, target: e.target, stagePath: copy, reason: e.reason });
      } else {
        todo.push(e);
      }
    }
  } finally {
    try { if (deps.lstatType(checkIndex).type !== 'missing') deps.unlink(checkIndex); } catch { /* best effort */ }
  }
  if (superseded.length) {
    const items = superseded.map((s) => ({
      section: LOG_SECTION,
      entry: formatEntry({
        status: 'SKIP', now: deps.now(), step: STEP,
        text: `skill update for ${skillLabel(s.target)} (${oneLine(manifest.find((e) => e.id === s.id).summary)}) already rides the run branch; not delivered twice`,
        reversibility: 'high',
      }),
    }));
    try { deps.appendEntries({ runDir, items }); } catch { /* the manifest status is the record */ }
  }
  return { todo, superseded, already };
}

// Every staged/wrap-up-skill-{N}.md as { path, target, invariant, diff }: its Target: and Invariant:
// lines and the bytes after the preamble's blank line (empty for a description-only stage). A file a
// manifest entry already names as its stagePath (by name: the stored path predates any archival) is
// taken from the start, never claimed for another entry. An unreadable staged/ is none.
function stagedCopies(runDir, manifest, deps) {
  const owned = new Set(manifest.filter((e) => e.stagePath).map((e) => path.basename(String(e.stagePath))));
  const dir = path.join(runDir, 'staged');
  let names = [];
  try { names = deps.readdir(dir).filter((n) => /^wrap-up-skill-\d+\.md$/.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    let bytes;
    try { bytes = Buffer.from(deps.readFile(path.join(dir, n))); } catch { continue; }
    const end = bytes.indexOf('\n\n');
    if (end < 0) continue;
    const head = bytes.subarray(0, end).toString('utf8');
    const m = /^Target: (.*)$/m.exec(head);
    const inv = /^Invariant: (.*)$/m.exec(head);
    if (m) out.push({ path: path.join(dir, n), target: m[1], invariant: inv ? inv[1] : null, diff: bytes.subarray(end + 2), taken: owned.has(n) });
  }
  return out;
}

// The staged file that already holds this captured entry's edit (a run whose manifest write failed
// after staging it): same target, and its diff block is the patch's bytes exactly, or, for a
// description-only stage (no diff block), its Invariant: is the entry's summary. Each file is claimed
// once. Returns its path, or null.
function stagedCopyOf(entry, copies, deps) {
  if (!copies.length) return null;
  let patch;
  try { patch = Buffer.from(deps.readFile(entry.patch)); } catch { return null; }
  const summary = oneLine(entry.summary);
  const hit = copies.find((c) => !c.taken && c.target === entry.target
    && (c.diff.equals(patch) || (c.diff.length === 0 && c.invariant === summary)));
  if (!hit) return null;
  hit.taken = true;
  return hit.path;
}

// Stages one entry through the shared writer. Returns { ok: true, row } or { ok: false, error }.
function stageOne({ runDir, worktree, entry, reason, deps, headShort }) {
  try {
    const patch = deps.readFile(entry.patch);
    const res = stageEntry({
      runDir, worktree, entry: { target: entry.target, summary: entry.summary, patch, patchFile: entry.patch, findings: entryFindings(entry) }, reason, headShort,
    }, deps);
    entry.status = STATUS.STAGED;
    entry.stagePath = res.stagePath;
    entry.reason = oneLine(reason);
    const row = { id: entry.id, target: entry.target, stagePath: res.stagePath, reason: entry.reason };
    if (res.logFailed) row.logFailed = true;
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: { id: entry.id, target: entry.target, error: firstStderrLine(err) } };
  }
}

function stageAll({ runDir, worktree, entries, reason, deps, out, headShort }) {
  for (const entry of entries) {
    const r = stageOne({ runDir, worktree, entry, reason, deps, headShort });
    if (r.ok) out.staged.push(r.row);
    else (out.failed = out.failed || []).push(r.error);
  }
}

// Writes the manifest. A failure is reported (manifestFailed), never thrown: the staged files and
// the PR already exist, a throw reads as "nothing happened", and the caller's fallback would deliver
// them again. A later land or stage re-records them (triage recognises a staged copy).
function recordManifest(runDir, manifest, deps, out) {
  try { writeManifest(runDir, manifest, deps); } catch { out.manifestFailed = true; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// stage

function stage({ runDir, worktree, reason, mergeBase }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  checkCommon({ runDir, worktree });
  const headShort = headShortReader(worktree, deps);
  const why = oneLine(reason);
  if (!why) throw new UsageError('reason is required');
  const base = checkMergeBase(mergeBase);
  const manifest = readLocalManifest(runDir);
  const out = { staged: [] };
  const { todo, superseded, already } = triage({ runDir, worktree, mergeBase: base, manifest, deps });
  if (superseded.length) out.superseded = superseded;
  out.staged.push(...already);
  stageAll({ runDir, worktree, entries: todo, reason: why, deps, out, headShort });
  if (todo.length || superseded.length || already.length) recordManifest(runDir, manifest, deps, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// land

// The Learned-Skills-Entry trailer keys a pushed commit to its manifest entry, so a resume recognises
// it by entry id (never by subject: a re-captured edit on a landed target has the same subject).
function commitMessage(entry, records, runId) {
  const from = records.map((r) => `#${r}`).join(', ');
  const subject = `Add learned skill update to ${entry.target} — from ${from}'s wrap-up`;
  return `${subject}\n\nLearned-Skills-Run: ${runId}\nLearned-Skills-Entry: ${entry.id}\n`;
}

// The run id and entry id a commit message's trailers carry (null when absent).
function trailers(message) {
  const text = String(message == null ? '' : message);
  const run = /^Learned-Skills-Run: (.+)$/m.exec(text);
  const id = /^Learned-Skills-Entry: (\S+)$/m.exec(text);
  return { run: run ? run[1].trim() : null, id: id ? id[1] : null };
}

// HTML comments in a summary could plant a marker (<!-- claude-tweaks-run: …) in the PR body.
const defang = (text) => String(text).replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
// An @ in a summary (@user, @org/team, @types/node) would notify that account when the PR opens; a
// zero-width space after it keeps the text and drops the mention (driver/events.js's form).
const unmention = (text) => String(text).replace(/@/g, '@\u200B');

function prBody(records, entries) {
  const refs = records.map((r) => `refs #${r}`).join(', ');
  const rows = entries.flatMap((e) => entryFindings(e).map((f) => `- \`${defang(skillLabel(e.target))}\` — ${unmention(defang(oneLine(f.summary)))}`));
  const text = [
    MARKER,
    `Learned skill updates from wrap-up (${refs}).`,
    '',
    ...rows,
    '',
    'Opened ready and never armed: a human merges this, or closes it.',
    '',
  ].join('\n');
  return neutralizeClosingPhrases(text).text;
}

function land({ runDir, worktree, record, integrationBranch, mergeBase }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  checkCommon({ runDir, worktree });
  const headShort = headShortReader(worktree, deps);
  const records = normalizeRecords(record);
  if (typeof integrationBranch !== 'string' || !integrationBranch.trim() || integrationBranch.startsWith('-')) {
    throw new UsageError('integrationBranch must be a branch name');
  }
  const base = checkMergeBase(mergeBase);
  const runId = path.basename(runDir);
  const branch = `learned-skills/${runId}`;
  const git = (args, opts) => deps.git(['-C', worktree, ...args], opts);

  // Every PR this branch ever had, whatever its state.
  const listPrs = () => {
    const rows = JSON.parse(deps.gh(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,state']));
    if (!Array.isArray(rows)) throw new Error('gh pr list did not return an array');
    return rows;
  };
  const openOf = (rows) => rows.find((r) => r.state === 'OPEN') || null;

  const manifest = readLocalManifest(runDir);
  const prior = [...manifest].reverse().find((e) => e.status === STATUS.LANDED && e.pr);
  // pr is reported only when this call confirmed it open.
  const out = { branch, pr: null, landed: [], staged: [] };
  const confirmed = (pr) => ({ number: Number(pr.number), url: pr.url });

  const { todo, superseded, already } = triage({ runDir, worktree, mergeBase: base, manifest, deps });
  if (superseded.length) out.superseded = superseded;
  out.staged.push(...already);
  // todo shrinks as a merged PR's entries are recorded, so whether to write the manifest is fixed here.
  const changed = Boolean(todo.length || superseded.length || already.length);
  // AUTO items for landed entries, written by finish on every return path. A re-land of the same
  // commits (a recovery) writes no line an earlier call already wrote.
  const pending = [];
  const sansTime = (line) => String(line).replace(/^- AUTO \d\d:\d\d:\d\d /, '');
  const flushLog = (result) => {
    const items = pending.splice(0);
    if (!items.length) return result;
    let logged = new Set();
    try { logged = new Set(String(deps.readFile(path.join(runDir, 'decisions.md'))).split(/\r?\n/).map(sansTime)); } catch { /* no log yet */ }
    const unlogged = items.filter((i) => !logged.has(sansTime(i.entry)));
    if (unlogged.length) { try { deps.appendEntries({ runDir, items: unlogged }); } catch { result.logFailed = true; } }
    return result;
  };
  const finish = () => flushLog(changed ? recordManifest(runDir, manifest, deps, out) : out);
  if (!todo.length) {
    if (prior) { try { const open = openOf(listPrs()); if (open) out.pr = confirmed(open); } catch { /* unconfirmed: reported as null */ } }
    return finish();
  }

  const downgradeAll = (entries, why) => {
    stageAll({ runDir, worktree, entries, reason: why, deps, out, headShort });
    return finish();
  };

  const indexFile = path.join(patchDir(runDir), 'index.tmp');
  const planEnv = () => gitEnv({ GIT_INDEX_FILE: indexFile });

  // A pushed commit is this entry's only when its own diff has the entry's current patch's patch-id.
  const patchId = (bytes) => String(git(['patch-id', '--stable'], { input: bytes })).trim().split(/\s+/)[0] || null;
  const sameEdit = (commit, entry) => {
    try {
      const committed = git(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--binary', '--end-of-options', `${commit}^`, commit], { encoding: 'buffer' });
      const a = patchId(committed);
      return a !== null && a === patchId(deps.readFile(entry.patch));
    } catch { return false; }
  };

  // Records an entry landed on prRef and queues one AUTO line per finding it carries, each under its
  // own row, all naming the one commit. ownPr: the landed[] row names its PR (a merged PR this call
  // recorded it against, not the one top-level pr).
  const markLanded = (entry, commit, prRef, ownPr) => {
    let short = commit.slice(0, 7);
    try { short = String(git(['rev-parse', '--verify', '--short', '--end-of-options', commit])).trim() || short; } catch { /* keep the slice */ }
    entry.status = STATUS.LANDED;
    entry.commit = commit;
    entry.pr = prRef;
    const row = { id: entry.id, target: entry.target, commit };
    if (ownPr) row.pr = prRef;
    out.landed.push(row);
    for (const f of entryFindings(entry)) {
      pending.push({
        section: LOG_SECTION,
        entry: formatEntry({
          status: 'AUTO', now: deps.now(), step: rowLabel(f.row),
          text: `applied additive update to ${skillLabel(entry.target)} (${oneLine(f.summary)}) on learned-skills PR #${prRef.number}`,
          reversibility: `high; commit: ${short}`,
        }),
      });
    }
  };

  try {
    deps.mkdir(path.dirname(indexFile));

    // 1. The base: the existing remote branch (a resumed run), else the integration branch's tip.
    let integrationSha;
    let tip = null;
    let orphanReason = null;
    try {
      git(['fetch', '--end-of-options', 'origin', integrationBranch], { timeout: GIT_TIMEOUT_MS });
      integrationSha = String(git(['rev-parse', '--verify', '--end-of-options', `origin/${integrationBranch}^{commit}`])).trim();
      const listed = String(git(['ls-remote', '--heads', '--end-of-options', 'origin', `refs/heads/${branch}`], { timeout: GIT_TIMEOUT_MS }));
      const line = listed.split(/\r?\n/).map((l) => l.split(/\s+/)).find((p) => p[1] === `refs/heads/${branch}`);
      if (line) {
        git(['fetch', '--end-of-options', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeout: GIT_TIMEOUT_MS });
        tip = String(git(['rev-parse', '--verify', '--end-of-options', `origin/${branch}^{commit}`])).trim();
        if (tip !== line[0]) throw new Error(`the remote ${branch} moved while it was fetched`);
      }
    } catch (err) {
      return downgradeAll(todo, `could not read the remote base (${firstStderrLine(err)})`);
    }
    const branchExisted = tip !== null;

    // The branch's PRs, by head name, whether or not the branch still exists (merging deletes it).
    let rows;
    try { rows = listPrs(); } catch (err) {
      return downgradeAll(todo, `could not list the PRs of ${branch} (${firstStderrLine(err)})`);
    }
    const existingPr = openOf(rows);
    const mergedPrs = rows.filter((r) => r.state === 'MERGED');

    // A merged PR may already have shipped captured entries (a run that died after the merge, before
    // its manifest write). Every merged PR's commits are read before anything is marked, so a failed
    // read stages every remaining entry and builds nothing.
    const mergedCommits = [];
    for (const m of mergedPrs) {
      const n = String(m.number);
      if (!/^[1-9]\d*$/.test(n)) return downgradeAll(todo, `could not read merged PR #${n}'s commits (its number is not a positive integer)`);
      try {
        git(['fetch', '--end-of-options', 'origin', `refs/pull/${n}/head`], { timeout: GIT_TIMEOUT_MS });
      } catch (err) {
        return downgradeAll(todo, `could not fetch merged PR #${n}'s commits (refs/pull/${n}/head: ${firstStderrLine(err)})`);
      }
      try {
        const pages = JSON.parse(deps.gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/pulls/${n}/commits?per_page=100`]));
        if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('gh api did not return pages of commits');
        mergedCommits.push({ pr: confirmed(m), commits: pages.flat() });
      } catch (err) {
        return downgradeAll(todo, `could not read merged PR #${n}'s commits (${firstStderrLine(err)})`);
      }
    }
    for (const { pr, commits: shipped } of mergedCommits) {
      for (const c of shipped) {
        const sha = c && typeof c.sha === 'string' ? c.sha : '';
        if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) continue;
        const t = trailers(c.commit && c.commit.message);
        if (t.run !== runId || !t.id) continue;
        const i = todo.findIndex((e) => String(e.id) === t.id);
        if (i < 0 || !sameEdit(sha, todo[i])) continue;
        markLanded(todo[i], sha, pr, true);
        todo.splice(i, 1);
      }
    }
    if (!todo.length) {
      if (existingPr) out.pr = confirmed(existingPr);
      return finish();
    }

    if (!existingPr) {
      const merged = mergedPrs[0];
      const closed = rows.find((r) => r.state === 'CLOSED');
      if (merged) orphanReason = `the earlier learned-skills PR #${merged.number} was merged, so ${branch} is not reused as a base`;
      else if (closed && branchExisted) orphanReason = `${branch} already exists on origin and PR #${closed.number} was closed; the branch is left untouched`;
      // No PR ever: an existing branch is this run's own (a crash between push and create) and stays the base.
    }
    // A closed or merged PR means the branch's commits were rejected or shipped: never a base.
    if (orphanReason) return downgradeAll(todo, orphanReason);

    // Every commit on the branch, with the run id and entry id its trailers carry.
    const commits = [];
    let logError = null;
    if (branchExisted) {
      try {
        const raw = String(git(['log', '-z', '--format=%H%x09%B', '--end-of-options', `${integrationSha}..${tip}`]));
        for (const rec of splitNul(raw)) {
          const tab = rec.indexOf('\t');
          if (tab <= 0) continue;
          commits.push({ sha: rec.slice(0, tab), ...trailers(rec) });
        }
      } catch (err) { logError = err; }
    }

    // An existing branch, open PR or none, is a base only if every commit on it is this run's edit of a
    // landed or still-captured entry. Anything else (a staged or superseded entry's commit left by a
    // failed delete, a foreign commit, an unreadable log) would ride the PR. The commits that pass are
    // the only ones a captured entry may reuse.
    const onBranch = new Map(); // captured entry id -> its verified commit
    if (branchExisted) {
      const stray = logError ? `its commits could not be read (${firstStderrLine(logError)})` : commits.map((c) => {
        const entry = c.run === runId && c.id ? manifest.find((e) => String(e.id) === c.id) : null;
        if (!entry) return `${c.sha.slice(0, 7)} maps to no entry of this run`;
        if (entry.status !== STATUS.CAPTURED && entry.status !== STATUS.LANDED) return `${c.sha.slice(0, 7)} belongs to entry ${entry.id}, which is ${entry.status}`;
        if (!sameEdit(c.sha, entry)) return `${c.sha.slice(0, 7)} does not hold entry ${entry.id}'s current edit`;
        if (entry.status === STATUS.CAPTURED) onBranch.set(String(entry.id), c.sha);
        return null;
      }).find(Boolean);
      const where = existingPr ? `open PR #${existingPr.number} (${existingPr.url})` : 'no PR';
      if (stray) return downgradeAll(todo, `${branch} already exists on origin with ${where} but cannot be reused as a base: ${stray}`);
    }

    // 2. One plumbing commit per patch, on a temp index.
    let parent = tip || integrationSha;
    const built = [];
    for (const entry of todo) {
      const msg = commitMessage(entry, records, runId);
      if (onBranch.has(String(entry.id))) {
        built.push({ entry, commit: onBranch.get(String(entry.id)), reused: true });
        continue;
      }
      let step = 'git read-tree';
      try {
        git(['read-tree', '--end-of-options', parent], { env: planEnv() });
        step = 'git apply --check';
        git(['apply', '--cached', '--check', '--end-of-options', entry.patch], { env: planEnv() });
        step = 'git apply --cached';
        git(['apply', '--cached', '--end-of-options', entry.patch], { env: planEnv() });
        step = 'git write-tree';
        const tree = String(git(['write-tree'], { env: planEnv() })).trim();
        step = 'git commit-tree';
        const commit = String(git(['commit-tree', tree, '-p', parent, '-F', '-'], { env: planEnv(), input: msg })).trim();
        parent = commit;
        built.push({ entry, commit, reused: false });
      } catch (err) {
        const why = step === 'git apply --check'
          ? `the patch no longer applies to ${tip ? branch : `origin/${integrationBranch}`} (git apply --check: ${firstStderrLine(err)})`
          : `could not build the commit (${step}: ${firstStderrLine(err)})`;
        stageAll({ runDir, worktree, entries: [entry], reason: why, deps, out, headShort });
      }
    }
    if (!built.length) return finish();
    const fresh = built.filter((b) => !b.reused);

    // 3. Push the new tip.
    let pushed = false;
    if (fresh.length) {
      try {
        git(['push', '--end-of-options', 'origin', `${parent}:refs/heads/${branch}`], { timeout: GIT_PUSH_TIMEOUT_MS });
        pushed = true;
      } catch (err) {
        // The new commits are staged; reused commits already sit on the open PR's branch, so they land.
        stageAll({ runDir, worktree, entries: fresh.map((b) => b.entry), reason: `push of ${branch} failed (${firstStderrLine(err)})`, deps, out, headShort });
        built.splice(0, built.length, ...built.filter((b) => b.reused));
        if (!built.length) return finish();
      }
    }

    // 4. The PR: the open one an existing branch carries, else create it ready and unarmed and re-read
    //    it before trusting it.
    const entries = built.map((b) => b.entry);
    let pr = existingPr;
    try {
      if (!pr) {
        const title = neutralizeClosingPhrases(`Add learned skill updates from wrap-up of ${records.map((r) => `#${r}`).join(', ')}`).text;
        let createErr = null;
        try {
          deps.gh(['pr', 'create', '--base', integrationBranch, '--head', branch, '--title', title, '--body-file', '-'], prBody(records, entries));
        } catch (err) { createErr = err; }
        // Re-read before trusting the create, or before taking the branch down after it errored: gh
        // can error after GitHub opened the PR, and an OPEN PR on this run's branch is this call's.
        let open = null;
        try { open = openOf(listPrs()); } catch (readErr) {
          if (createErr) throw createErr;
          // The create went through: the downgrade names the failed read, not a failed create.
          throw Object.assign(new Error(`the created PR could not be read back (${firstStderrLine(readErr)})`), { readBack: true });
        }
        if (!open) throw createErr || new Error('the created PR does not read OPEN');
        pr = open;
      }
    } catch (err) {
      // Every entry is staged, so take the branch down (it is this call's or this run's own, with no PR):
      // a later run must not inherit commits whose patches are staged instead.
      let note = '';
      try { git(['push', '--end-of-options', 'origin', `:refs/heads/${branch}`], { timeout: GIT_PUSH_TIMEOUT_MS }); } catch (delErr) {
        note = `; the branch ${branch} could not be deleted and still holds these commits (${firstStderrLine(delErr)})`;
      }
      return downgradeAll(entries, `${err && err.readBack ? err.message : `gh pr create failed (${firstStderrLine(err)})`}${note}`);
    }

    // 5. Record and log.
    const prRef = confirmed(pr);
    for (const b of built) markLanded(b.entry, b.commit, prRef, false);
    out.pr = prRef;
    // Commits added to an open PR: its body lists only the earlier call's entries, so rewrite it with
    // every entry landed on it. The number is gh's own integer, never caller text. A failure leaves the
    // commits on the PR and is reported.
    if (existingPr && pushed) {
      const onPr = manifest.filter((e) => e.status === STATUS.LANDED && e.pr && e.pr.number === prRef.number);
      try { deps.gh(['pr', 'edit', String(prRef.number), '--body-file', '-'], prBody(records, onPr)); } catch { out.prBodyStale = true; }
    }
    // The edits are on the PR by now: a failed manifest write is reported (finish), and a later land
    // reuses the verified commits and records them.
    return finish();
  } finally {
    try { if (deps.lstatType(indexFile).type !== 'missing') deps.unlink(indexFile); } catch { /* best effort */ }
  }
}

module.exports = { land, stage, MARKER, defang, unmention };
