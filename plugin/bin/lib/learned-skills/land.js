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
// Resume: an entry already `landed` is skipped; an existing remote branch is the base; an open PR is
// reused; a patch whose commit is already on that branch (a run that died before its manifest write)
// is recognised by its Learned-Skills-Entry trailer (never one a landed entry claims) and marked landed instead of being committed twice.
// A `captured` entry whose target the run branch changed after the merge base is `superseded`, never
// delivered (capture's bothInTree/stuck outcomes leave the edit in the tree for the run branch).
//
// Every side effect goes through `deps` (git, gh, now, appendEntries, fs seams) so tests inject fakes.
'use strict';

const path = require('path');
const { splitNul } = require('../git-z');
const { formatEntry } = require('../log-decision/append');
const { neutralizeClosingPhrases } = require('../flow/closing-links');
const { GIT_TIMEOUT_MS, GIT_PUSH_TIMEOUT_MS } = require('../shared-primitives');
const {
  UsageError, realDeps, readManifest, writeManifest, skillLabel, stageEntry, LOG_SECTION, STEP,
} = require('./learned-skills');

const MARKER = '<!-- wrap-up-skills-pr -->';

function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function firstLine(e) {
  const lines = (s) => String(s == null ? '' : s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines(e && e.stderr)[0] || lines(e && e.message)[0] || String(e);
}

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

// Splits the manifest's captured entries into those to deliver and those the run branch already
// carries. An entry is superseded only when the run branch changed its target after the merge base AND
// the entry's patch reverse-applies to HEAD's tree (the edit itself is on the run branch); a target the
// run branch changed some other way is delivered as usual. Mutates `manifest` entries for the
// superseded ones.
function triage({ runDir, worktree, mergeBase, manifest, deps }) {
  const captured = manifest.filter((e) => e.status === 'captured');
  const todo = [];
  const superseded = [];
  let owned = [];
  if (captured.length) {
    owned = splitNul(deps.git(['-C', worktree, '-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--end-of-options', mergeBase, 'HEAD', '--']));
  }
  const checkIndex = path.join(runDir, 'learned-skills', 'index-check.tmp');
  const carried = (e) => {
    const env = { ...process.env, GIT_INDEX_FILE: checkIndex };
    try {
      deps.mkdir(path.dirname(checkIndex));
      deps.git(['-C', worktree, 'read-tree', '--end-of-options', 'HEAD'], { env });
      deps.git(['-C', worktree, 'apply', '--cached', '--check', '-R', '--end-of-options', e.patch], { env });
      return true;
    } catch { return false; }
  };
  try {
    for (const e of captured) {
      if (owned.includes(e.target) && carried(e)) {
        e.status = 'superseded';
        e.reason = 'the run branch already carries this edit, so it travels with the record';
        superseded.push({ id: e.id, target: e.target, reason: e.reason });
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
  return { todo, superseded };
}

// Stages one entry through the shared writer. Returns { ok: true, row } or { ok: false, error }.
function stageOne({ runDir, worktree, entry, reason, deps }) {
  try {
    const patch = deps.readFile(entry.patch);
    const res = stageEntry({
      runDir, worktree, entry: { target: entry.target, summary: entry.summary, patch, patchFile: entry.patch }, reason,
    }, deps);
    entry.status = 'staged';
    entry.stagePath = res.stagePath;
    entry.reason = oneLine(reason);
    const row = { id: entry.id, target: entry.target, stagePath: res.stagePath, reason: entry.reason };
    if (res.logFailed) row.logFailed = true;
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: { id: entry.id, target: entry.target, error: firstLine(err) } };
  }
}

function stageAll({ runDir, worktree, entries, reason, deps, out }) {
  for (const entry of entries) {
    const r = stageOne({ runDir, worktree, entry, reason, deps });
    if (r.ok) out.staged.push(r.row);
    else (out.failed = out.failed || []).push(r.error);
  }
}

// ---------------------------------------------------------------------------------------------
// stage

function stage({ runDir, worktree, reason, mergeBase }, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  checkCommon({ runDir, worktree });
  const why = oneLine(reason);
  if (!why) throw new UsageError('reason is required');
  const base = checkMergeBase(mergeBase);
  const manifest = readManifest(runDir);
  const out = { staged: [] };
  const { todo, superseded } = triage({ runDir, worktree, mergeBase: base, manifest, deps });
  if (superseded.length) out.superseded = superseded;
  stageAll({ runDir, worktree, entries: todo, reason: why, deps, out });
  if (todo.length || superseded.length) writeManifest(runDir, manifest, deps);
  return out;
}

// ---------------------------------------------------------------------------------------------
// land

// The Learned-Skills-Entry trailer keys a pushed commit to its manifest entry, so a resume recognises
// it by entry id (never by subject: a re-captured edit on a landed target has the same subject).
function commitMessage(entry, records, runId) {
  const from = records.map((r) => `#${r}`).join(', ');
  const subject = `Add learned skill update to ${entry.target} — from ${from}'s wrap-up`;
  return { full: `${subject}\n\nLearned-Skills-Run: ${runId}\nLearned-Skills-Entry: ${entry.id}\n` };
}

// HTML comments in a summary could plant a marker (<!-- claude-tweaks-run: …) in the PR body.
const defang = (text) => String(text).replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');

function prBody(records, entries) {
  const refs = records.map((r) => `refs #${r}`).join(', ');
  const rows = entries.map((e) => `- \`${defang(skillLabel(e.target))}\` — ${defang(oneLine(e.summary))}`);
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
  const records = normalizeRecords(record);
  if (typeof integrationBranch !== 'string' || !integrationBranch.trim() || integrationBranch.startsWith('-')) {
    throw new UsageError('integrationBranch must be a branch name');
  }
  const base = checkMergeBase(mergeBase);
  const runId = path.basename(runDir);
  const branch = `learned-skills/${runId}`;
  const git = (args, opts) => deps.git(['-C', worktree, ...args], opts);

  const listOpen = () => {
    const rows = JSON.parse(deps.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,state']));
    if (!Array.isArray(rows)) throw new Error('gh pr list did not return an array');
    return rows.find((r) => r.state === 'OPEN') || null;
  };

  const manifest = readManifest(runDir);
  const prior = [...manifest].reverse().find((e) => e.status === 'landed' && e.pr);
  // pr is reported only when this call confirmed it open.
  const out = { branch, pr: null, landed: [], staged: [] };
  const confirmed = (pr) => ({ number: Number(pr.number), url: pr.url });

  const { todo, superseded } = triage({ runDir, worktree, mergeBase: base, manifest, deps });
  if (superseded.length) out.superseded = superseded;
  const finish = () => {
    if (todo.length || superseded.length) writeManifest(runDir, manifest, deps);
    return out;
  };
  if (!todo.length) {
    if (prior) { try { const open = listOpen(); if (open) out.pr = confirmed(open); } catch { /* unconfirmed: reported as null */ } }
    return finish();
  }

  const downgradeAll = (entries, why) => {
    stageAll({ runDir, worktree, entries, reason: why, deps, out });
    return finish();
  };

  const indexFile = path.join(runDir, 'learned-skills', 'index.tmp');
  const planEnv = () => ({ ...process.env, GIT_INDEX_FILE: indexFile });
  try {
    deps.mkdir(path.dirname(indexFile));

    // 1. The base: the existing remote branch (a resumed run), else the integration branch's tip.
    let integrationSha;
    let tip = null;
    let existingPr = null;
    try {
      git(['fetch', '--end-of-options', 'origin', integrationBranch], { timeout: GIT_TIMEOUT_MS });
      integrationSha = String(git(['rev-parse', '--verify', '--end-of-options', `origin/${integrationBranch}^{commit}`])).trim();
      const listed = String(git(['ls-remote', '--heads', '--end-of-options', 'origin', `refs/heads/${branch}`], { timeout: GIT_TIMEOUT_MS }));
      const line = listed.split(/\r?\n/).map((l) => l.split(/\s+/)).find((p) => p[1] === `refs/heads/${branch}`);
      if (line) {
        git(['fetch', '--end-of-options', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeout: GIT_TIMEOUT_MS });
        tip = String(git(['rev-parse', '--verify', '--end-of-options', `origin/${branch}^{commit}`])).trim();
        if (tip !== line[0]) throw new Error(`the remote ${branch} moved while it was fetched`);
        existingPr = listOpen();
      }
    } catch (err) {
      return downgradeAll(todo, `could not read the remote base (${firstLine(err)})`);
    }
    const branchExisted = tip !== null;
    // An existing branch is a base only with an open PR attached; otherwise its commits (rejected, or
    // never offered) would ride the next PR.
    if (branchExisted && !existingPr) {
      return downgradeAll(todo, `${branch} already exists on origin with no open PR (closed or never opened), so it is not reused as a base; its commits stay on it`);
    }

    // Commits already on the branch from a run that died before its manifest write: keyed by the
    // entry id in their trailer, never one a landed entry already claims.
    const onBranch = new Map();
    if (branchExisted) {
      const claimed = new Set(manifest.filter((e) => e.status === 'landed' && e.commit).map((e) => e.commit));
      try {
        const raw = String(git(['log', '-z', '--format=%H%x09%B', '--end-of-options', `${integrationSha}..${tip}`]));
        for (const rec of splitNul(raw)) {
          const tab = rec.indexOf('\t');
          if (tab <= 0) continue;
          const sha = rec.slice(0, tab);
          const run = /^Learned-Skills-Run: (.+)$/m.exec(rec);
          const id = /^Learned-Skills-Entry: (\S+)$/m.exec(rec);
          if (run && run[1].trim() === runId && id && !claimed.has(sha)) onBranch.set(id[1], sha);
        }
      } catch { /* an unreadable log just means nothing is recognised; apply --check then decides */ }
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
        const commit = String(git(['commit-tree', tree, '-p', parent, '-F', '-'], { env: planEnv(), input: msg.full })).trim();
        parent = commit;
        built.push({ entry, commit, reused: false });
      } catch (err) {
        const why = step === 'git apply --check'
          ? `the patch no longer applies to ${tip ? branch : `origin/${integrationBranch}`} (git apply --check: ${firstLine(err)})`
          : `could not build the commit (${step}: ${firstLine(err)})`;
        stageAll({ runDir, worktree, entries: [entry], reason: why, deps, out });
      }
    }
    if (!built.length) return finish();
    const fresh = built.filter((b) => !b.reused);

    // 3. Push the new tip.
    if (fresh.length) {
      try {
        git(['push', '--end-of-options', 'origin', `${parent}:refs/heads/${branch}`], { timeout: GIT_PUSH_TIMEOUT_MS });
      } catch (err) {
        // The new commits are staged; reused commits already sit on the open PR's branch, so they land.
        stageAll({ runDir, worktree, entries: fresh.map((b) => b.entry), reason: `push of ${branch} failed (${firstLine(err)})`, deps, out });
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
        deps.gh(['pr', 'create', '--base', integrationBranch, '--head', branch, '--title', title, '--body-file', '-'], prBody(records, entries));
        pr = listOpen();
        if (!pr) throw new Error('the created PR does not read OPEN');
      }
    } catch (err) {
      // The branch exists only because of this call (an existing one always has its PR): take it down,
      // so a later run cannot inherit commits whose patches are staged instead.
      let note = '';
      try { git(['push', '--end-of-options', 'origin', `:refs/heads/${branch}`], { timeout: GIT_PUSH_TIMEOUT_MS }); } catch (delErr) {
        note = `; the branch ${branch} could not be deleted and still holds these commits (${firstLine(delErr)})`;
      }
      return downgradeAll(entries, `gh pr create failed (${firstLine(err)})${note}`);
    }

    // 5. Record and log.
    const prRef = confirmed(pr);
    const items = [];
    for (const b of built) {
      let short = b.commit.slice(0, 7);
      try { short = String(git(['rev-parse', '--short', '--end-of-options', b.commit])).trim() || short; } catch { /* keep the slice */ }
      b.entry.status = 'landed';
      b.entry.commit = b.commit;
      b.entry.pr = prRef;
      out.landed.push({ id: b.entry.id, target: b.entry.target, commit: b.commit });
      items.push({
        section: LOG_SECTION,
        entry: formatEntry({
          status: 'AUTO', now: deps.now(), step: STEP,
          text: `applied additive update to ${skillLabel(b.entry.target)} (${oneLine(b.entry.summary)}) on learned-skills PR #${prRef.number}`,
          reversibility: `high; commit: ${short}`,
        }),
      });
    }
    out.pr = prRef;
    const result = finish();
    try { deps.appendEntries({ runDir, items }); } catch { result.logFailed = true; }
    return result;
  } finally {
    try { if (deps.lstatType(indexFile).type !== 'missing') deps.unlink(indexFile); } catch { /* best effort */ }
  }
}

module.exports = { land, stage, MARKER };
