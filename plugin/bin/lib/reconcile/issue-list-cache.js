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
'use strict';
const { defaultRunner } = require('../feedback/file-feedback');

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
function createIssueListCache({ base = defaultRunner } = {}) {
  const memo = new Map(); // repo -> parsed array of issue entries

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
      }
      return JSON.stringify(memo.get(repo));
    }

    const out = base(argv);
    const repo = repoFromArgv(argv);
    if (repo !== null && memo.has(repo)) applyWrite(memo.get(repo), argv, out);
    return out;
  }

  return { runner };
}

module.exports = {
  createIssueListCache, isIssueListCall, repoFromArgv, applyWrite,
};
