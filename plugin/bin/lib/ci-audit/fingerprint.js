// plugin/bin/lib/ci-audit/fingerprint.js — /claude-tweaks:ci-health's (#5757) finding identity.
// The id is health-core's createFingerprint over check, workflow, job and step, so the same lead
// on the same subject keeps one id across runs whatever the figures, claim or remedy say: a repeat
// run over unchanged data dedups against the issue it already filed. `step` is null except for
// repeated-work, whose subject is a step rather than a job (two repeated steps must not share an
// id). repeated-work is repo-wide, so its workflow hashes as null whatever the finding names (the
// validator already requires null there). createFingerprint strips the prefix's dash, so ids read `cihealth-<8 hex>`; the issue body
// carries the id through recordPayload's `work-fingerprint` marker.
'use strict';
const { createFingerprint } = require('../health-core/fingerprint');

const base = createFingerprint('ci-health', ['check', 'workflow', 'job', 'step']);

// A missing job or step hashes as null either way.
function fingerprint(finding) {
  const f = finding || {};
  return base.fingerprint({
    check: f.check,
    workflow: f.check === 'repeated-work' || f.workflow === undefined ? null : f.workflow,
    job: f.job === undefined ? null : f.job,
    step: f.step === undefined ? null : f.step,
  });
}

module.exports = { fingerprint };
