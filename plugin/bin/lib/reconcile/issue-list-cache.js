// bin/lib/reconcile/issue-list-cache.js — #2505: a shared, per-reconcile-pass
// cache for the `gh issue list --repo ... --state all --json ... --limit
// 10000` shape escalateResidue/resolveResidue's own findResidueDuplicate
// (escalate-residue.js) issues — that fetch is identical for every caller
// within one reconcile pass regardless of which (reason, path) or marker
// it's filtering for afterward, so N stuck dirs/paths escalating or
// resolving in the same pass were each paying for their own full-repo
// `gh issue list` round trip (#2505's Current State). Scoped to ONE
// createIssueListCache() instance's own lifetime — reconcile/index.js
// creates exactly one per reconcile() pass and threads its `runner` down
// through archiveMerged/reapMerged/cache.js's trackResidue/
// pruneResidueFailures into escalateResidue/resolveResidue's own
// injectable `runner` param (escalate-residue.js needs no changes — it
// already accepts one), so nothing here persists across passes or
// processes.
//
// Write-aware by design (#2505 review fix). A naive "memoize the raw list
// response" cache is unsound for this call graph: escalateResidue/
// resolveResidue WRITE through the same runner (issue create/edit/close/
// reopen) and then READ BACK within the same pass — most visibly for
// `structurally-stuck`, whose fingerprint is deliberately path-less
// (escalate-residue.js's residueFingerprint), so every stuck dir in a pass
// converges on the SAME consolidated record and each call's read depends
// on the previous call's write. A cache that serves a stale read after
// that write silently changes real behavior: N simultaneous escalations
// file N separate issues instead of one consolidated record (regressing
// #1811-#1817's original symptom), and a resolve loop resurrects paths it
// just removed from a record's body, so the record never closes. This
// module avoids that by memoizing the PARSED issue array (not the raw
// response string) and applying each write's effect to that array
// directly — so a later read within the same pass reflects every prior
// write in that pass, at zero additional `gh issue list` cost. This
// deliberately couples this module to escalate-residue.js's own write
// vocabulary (create/edit/close/reopen only — `issue comment` never
// changes list-visible state and needs no handling); that coupling is the
// point, not a smell to design around, since this module has no other
// caller today.
//
// #4032 — marker index. The one thing that DOES cross passes is `index`, a
// `{ "{repo}\n{marker}": issueNumber }` map reconcile/index.js loads from and
// writes back to the reconcile cache. `runner.findIssueByMarker(repo, marker)`
// answers a residue dedup lookup with ONE `gh issue view <n>` instead of the
// full-repo list: it returns the issue when its body still carries the marker,
// and `undefined` ("cannot answer, do the list") when this pass already holds
// the memoized list for the repo, when `index` has no entry, or when the view
// fails or no longer carries the marker (that entry is dropped). Every memoized
// list read indexes the canonical issue per reconcile-residue marker; an
// `issue create` indexes its own body's marker. Known divergence: with
// duplicates, the indexed issue (canonical at index time) answers even if
// another process later filed a newer duplicate — the list path would have
// picked the newer one.
'use strict';
const { performance } = require('perf_hooks');
const { defaultRunner } = require('../feedback/file-feedback');
const { findByMarker } = require('../issues/dedup-lookup');
const { recordSubprocess } = require('./timing');

const RESIDUE_MARKER_RE = /<!-- fingerprint: reconcile-residue-[0-9a-f]+ -->/g;

function indexKey(repo, marker) {
  return `${repo}\n${marker}`;
}

// Only this exact shape is memoized — every other runner call is a write
// (or an unrecognized read) and always executes, never skipped.
function isIssueListCall(argv) {
  return Array.isArray(argv) && argv[0] === 'issue' && argv[1] === 'list';
}

function repoFromArgv(argv) {
  const i = argv.indexOf('--repo');
  return (i === -1 || i + 1 >= argv.length) ? null : argv[i + 1];
}

function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return (i === -1 || i + 1 >= argv.length) ? null : argv[i + 1];
}

// Applies one write command's effect to the memoized `entries` array in
// place, mirroring what the equivalent real `gh` write would make a FRESH
// `issue list` read show afterward. Unrecognized verbs (`comment`, or
// anything this module doesn't know about) are a deliberate no-op — never
// throws, never invalidates: a write this function can't interpret simply
// leaves the memo as of the last real read, which is the same "might be
// slightly stale" risk every cache already carries at its first read.
function applyWrite(entries, argv, rawOutput) {
  if (!Array.isArray(argv) || argv[0] !== 'issue') return;
  const verb = argv[1];
  if (verb === 'create') {
    const m = /\/issues\/(\d+)/.exec(String(rawOutput));
    if (!m) return; // create's own output didn't report a number — nothing to synthesize
    entries.push({
      number: Number(m[1]),
      title: flagValue(argv, '--title') || '',
      body: flagValue(argv, '--body') || '',
      createdAt: new Date().toISOString(),
      state: 'OPEN',
    });
    return;
  }
  if (verb === 'edit' || verb === 'close' || verb === 'reopen') {
    const number = Number(argv[2]);
    const entry = entries.find((e) => e.number === number);
    if (!entry) return; // this issue isn't in the memo — nothing to update
    if (verb === 'edit') {
      const body = flagValue(argv, '--body');
      if (body !== null) entry.body = body;
    } else if (verb === 'close') {
      entry.state = 'CLOSED';
    } else {
      entry.state = 'OPEN';
    }
  }
}

// { base?: (argv) => string } -> { runner: (argv) => string }
// `base` defaults to the real `gh` runner (file-feedback.js's
// defaultRunner) so production callers (reconcile/index.js) need pass
// nothing; tests inject a counting/stateful fake instead. A thrown `base`
// call on a `list` read is never cached — the memo is only populated
// after a successful, parseable response, so the next call for that repo
// retries rather than replaying a failure. A response that isn't valid
// JSON is handed back verbatim, also uncached, rather than throwing here —
// the caller's own JSON.parse (inside findResidueDuplicate) is what
// surfaces that failure.
function createIssueListCache({ base: rawBase = defaultRunner, index = {} } = {}) {
  const memo = new Map(); // repo -> parsed array of issue entries

  // #4032: every real `gh issue …` round trip is timed as a `gh` spawn (the
  // default runner's own execFileSync is deliberately left raw — it lives in
  // feedback/, outside reconcile). A memo hit never reaches here, so it records
  // nothing. recordSubprocess never throws, so the call's own return/throw is
  // exactly rawBase's.
  function base(argv) {
    const start = performance.now();
    try {
      return rawBase(argv);
    } finally {
      recordSubprocess('gh', argv, performance.now() - start);
    }
  }

  // Index the canonical issue per reconcile-residue marker found in `issues`.
  function indexIssues(repo, issues) {
    const byMarker = new Map();
    for (const issue of issues) {
      if (!issue || typeof issue.body !== 'string') continue;
      for (const marker of new Set(issue.body.match(RESIDUE_MARKER_RE) || [])) {
        if (!byMarker.has(marker)) byMarker.set(marker, []);
        byMarker.get(marker).push(issue);
      }
    }
    for (const [marker, group] of byMarker) {
      const found = findByMarker(group, marker);
      if (found && Number.isInteger(found.canonical.number)) index[indexKey(repo, marker)] = found.canonical.number;
    }
  }

  function runner(argv) {
    if (isIssueListCall(argv)) {
      const repo = repoFromArgv(argv);
      if (repo === null) return base(argv);
      if (!memo.has(repo)) {
        const out = base(argv);
        let parsed;
        try {
          parsed = JSON.parse(out);
        } catch {
          return out; // unparseable response — never cache a bad read
        }
        memo.set(repo, Array.isArray(parsed) ? parsed : []);
        indexIssues(repo, memo.get(repo));
      }
      return JSON.stringify(memo.get(repo));
    }

    const out = base(argv);
    const repo = repoFromArgv(argv);
    if (repo !== null && memo.has(repo)) applyWrite(memo.get(repo), argv, out);
    if (repo !== null && argv[0] === 'issue' && argv[1] === 'create') {
      const created = /\/issues\/(\d+)/.exec(String(out));
      const markers = created ? (flagValue(argv, '--body') || '').match(RESIDUE_MARKER_RE) : null;
      if (markers) for (const marker of new Set(markers)) index[indexKey(repo, marker)] = Number(created[1]);
    }
    return out;
  }

  // undefined = "cannot answer, do the list" (see the header's #4032 note).
  runner.findIssueByMarker = function findIssueByMarker(repo, marker) {
    if (memo.has(repo)) return undefined; // the memo is cheaper and write-aware
    const key = indexKey(repo, marker);
    if (!Object.hasOwn(index, key)) return undefined;
    let issue;
    try {
      issue = JSON.parse(base(['issue', 'view', String(index[key]), '--repo', repo, '--json', 'number,title,body,createdAt,state']));
    } catch {
      return undefined;
    }
    if (findByMarker([issue], marker)) return issue;
    delete index[key];
    return undefined;
  };

  return { runner, index };
}

module.exports = {
  createIssueListCache, isIssueListCall, repoFromArgv, applyWrite,
};
