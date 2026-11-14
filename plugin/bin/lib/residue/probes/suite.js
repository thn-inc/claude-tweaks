// bin/lib/residue/probes/suite.js — the project's own test suite at close time.
//
// This is the `blast-radius` class: a suite red at close time is this run's
// own concern regardless of why it's red — the session hit it, so it belongs
// in the report under every scope, not just `repo`. A suite that could not be
// run, timed out, or overflowed the output capture buffer, reports
// `ran: false` — never green.
'use strict';

const { makeFinding } = require('../finding');

function probeSuite({ scope, run } = {}) {
  if (!scope || !scope.ran) {
    return { ran: false, reason: (scope && scope.reason) || 'scope unresolved', findings: [] };
  }
  const result = run();
  if (result === null) return { ran: false, reason: 'could not run the project test command', findings: [] };
  if (result.timedOut) return { ran: false, reason: 'test command timed out', findings: [] };
  if (result.bufferOverflowed) return { ran: false, reason: 'test output exceeded capture buffer', findings: [] };
  if (result.code === 0) return { ran: true, reason: null, findings: [] };

  const allFailing = String(result.stdout || '').split('\n').filter((l) => l.startsWith('not ok'));
  const failing = allFailing.slice(0, 5);
  const truncated = allFailing.length > failing.length ? ` (+${allFailing.length - failing.length} more)` : '';
  return {
    ran: true,
    reason: null,
    findings: [makeFinding({
      kind: 'suite',
      scope: 'blast-radius',
      subject: `test suite exit ${result.code}`,
      remedy: 'record',
      evidence: failing.length ? `${failing.join('; ')}${truncated}` : `test command exited ${result.code}`,
    })],
  };
}

// Under a declaration's `localRuns: "on-request"` the suite is the PR's CI job's
// to run, and a bare `npm test` here may run a subset or nothing (#5319), so its
// exit 0 would be no green suite. Pure: the caller reads the declaration, and an
// unreadable one reads as no key (#5370).
function localRunsSkip(decl) {
  if (!(decl && decl.localRuns === 'on-request' && decl.ci)) return null;
  const jobs = Object.entries(decl.ci).map(([suite, c]) => `${suite} (${c.workflow} / ${c.job})`).join(', ');
  return {
    ran: false,
    reason: `not run on this machine — the declaration's localRuns "on-request" takes ${jobs} from the PR's CI job; /claude-tweaks:test full runs it here`,
    findings: [],
  };
}

module.exports = { probeSuite, localRunsSkip };
