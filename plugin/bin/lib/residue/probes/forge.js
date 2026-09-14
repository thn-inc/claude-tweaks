// bin/lib/residue/probes/forge.js — open pull requests at residue-sweep
// time. Every open PR is a finding: this run's own head branch is
// `blast-radius` (this session's own open work, still worth surfacing —
// e.g. a forgotten draft PR from an earlier phase of the same run), and
// every other open PR is `observed` (another lane's in-flight work — never
// this run's concern to act on, only to make visible). `gh pr list`'s
// implicit default page size is 30 and truncates silently past it; this
// probe passes an explicit `--limit 100` for the same reason
// `_shared/github-pr-scan.md` documents it as this repo's convention for
// every other `gh pr list --state open` call site.
//
// The own-PR carve-out (#1781): under `integration-model: pr-first`, a run's
// recorded PR (its `run-state.json` `pr.number`, threaded in as `ownPr`) is
// open *by design* until wrap-up's Phase 4 decides merge/arm/park — not
// residue. Passing `ownPr` excludes exactly that PR number from `findings`
// and reports it on the `ownPr` result field instead. This carve-out is keyed
// on identity (the recorded PR number), not on head-branch equality alone: a
// *different*, stale PR on the same head branch — the "forgotten draft from
// an earlier phase" case this file's header comment protects — still reports
// as `blast-radius` exactly as before.
'use strict';

const { makeFinding } = require('../finding');

function probeForge({ scope, run, ownPr = null } = {}) {
  if (!scope || !scope.ran) {
    return { ran: false, reason: (scope && scope.reason) || 'scope unresolved', findings: [], ownPr: null };
  }
  // `gh`'s implicit default is 30 and truncates silently — `_shared/github-pr-scan.md`'s
  // documented convention, matched here with the same `--limit 100` this repo's other
  // `gh pr list --state open` call sites use.
  const argv = ['gh', 'pr', 'list', '--state', 'open', '--json', 'number,title,headRefName', '--limit', '100'];
  const out = run(argv);
  if (out === null) return { ran: false, reason: 'gh unavailable or not authenticated', findings: [], ownPr: null };

  let prs;
  try {
    prs = JSON.parse(out);
  } catch {
    return { ran: false, reason: 'could not parse gh pr list output', findings: [], ownPr: null };
  }
  if (!Array.isArray(prs)) return { ran: false, reason: 'could not parse gh pr list output', findings: [], ownPr: null };

  let ownPrResult = null;
  const findings = [];
  for (const pr of prs) {
    if (ownPr !== null && pr.number === ownPr) {
      ownPrResult = { number: pr.number, headRefName: pr.headRefName };
      continue;
    }
    const mine = scope.headBranch && pr.headRefName === scope.headBranch;
    findings.push(makeFinding({
      kind: 'pr',
      scope: mine ? 'blast-radius' : 'observed',
      subject: `PR #${pr.number}`,
      remedy: 'record',
      evidence: `${argv.join(' ')} — open, head ${pr.headRefName}${mine ? ' (this work)' : ' (another lane)'}`,
    }));
  }
  return { ran: true, reason: null, findings, ownPr: ownPrResult };
}

module.exports = { probeForge };
