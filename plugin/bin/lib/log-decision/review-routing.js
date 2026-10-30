// Compose one /review Step 3 Routing log line (#4488) — pure, no I/O.
// The gate in /claude-tweaks:release Step 3 classifies these lines by the literal
// tokens `critical finding` and `high-severity finding` (blocking) and
// `medium-severity finding` / `applied low-severity` (findings), so the text is
// fixed here rather than hand-typed per routing site. The write itself is
// log-decision.js's (bin/review-routing-line.js wires the two together).
'use strict';

const ROUTES = ['auto', 'staged', 'kept-prompt'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ROUTING_STEP = 'Step 3 Routing';
// Every severity a route ever takes under review/step3-routing.md's ceiling-keyed routing table, across all
// three ceilings (critical only via kept-prompt; high never auto-applies). A pairing the table never produces
// is refused rather than logged. tests/bin-lib/log-decision/review-routing.test.js pins this map to that table.
const ALLOWED_SEVERITIES = {
  auto: ['low', 'medium'],
  staged: ['low', 'medium', 'high'],
  'kept-prompt': ['critical'],
};
// Two staging shapes: a patch (review-{n}.patch), or a record proposal (review-followup-{n}.md, #4484).
const STAGE_PATH_RE = /^staged\/(?:review-\d+\.patch|review-followup-\d+\.md)$/;
// An abbreviated (7) through full SHA-1 (40) commit sha, the bound the repo's other sha validators use.
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
// The release gate classifies Step 3 lines by these literals; --category and --at are written into the line, so neither may inject one.
const GATE_TOKEN_RE = /severity finding|critical finding/i;

// --category and --at are written into the entry text, and --lever onto the same line: each must be a non-empty
// single line that carries no gate token.
function textProblem(flag, value) {
  if (typeof value !== 'string' || !value.trim()) return `${flag} is required (a non-empty string)`;
  if (/[\r\n]/.test(value)) return `${flag} must be a single line`;
  if (GATE_TOKEN_RE.test(value)) return `${flag} must not contain "severity finding" or "critical finding" (a release-gate token)`;
  return null;
}

// { route, severity, category, at, stagePath?, commit?, lever? } -> { status, text, reversibility } | { error }.
// `text` never begins with `Step 3 Routing:` (the step prefix is log-decision's to write), so the
// --text repeat refusal never fires on a composed line.
function composeRoutingLine({ route, severity, category, at, stagePath, commit, lever }) {
  if (!ROUTES.includes(route)) return { error: `--route must be one of ${ROUTES.join('|')}` };
  const sev = typeof severity === 'string' ? severity.toLowerCase() : severity;
  if (!SEVERITIES.includes(sev)) return { error: `--severity must be one of ${SEVERITIES.join('|')}` };
  if (!ALLOWED_SEVERITIES[route].includes(sev)) {
    return { error: `--route ${route} does not take --severity ${sev} (allowed: ${ALLOWED_SEVERITIES[route].join('|')})` };
  }
  const problem = textProblem('--category', category) || textProblem('--at', at) || (lever != null ? textProblem('--lever', lever) : null);
  if (problem) return { error: problem };

  if (route === 'auto') {
    if (stagePath != null) return { error: '--stage-path is not valid with --route auto' };
    if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) return { error: '--commit must be a 7-40 character lowercase hex commit sha' };
    // The commit rides in the reversibility qualifier (`Reversibility: high (commit {sha}).`), the form
    // log-decision.js's REVERSIBILITY_RE accepts — decided at #4488's plan review.
    return { status: 'AUTO', text: `applied ${sev}-severity ${category} fix at ${at}`, reversibility: `high (commit ${commit})` };
  }
  if (route === 'staged') {
    if (commit != null) return { error: '--commit is not valid with --route staged' };
    if (typeof stagePath !== 'string' || !STAGE_PATH_RE.test(stagePath)) {
      return { error: '--stage-path must match staged/review-{n}.patch or staged/review-followup-{n}.md with --route staged' };
    }
    return { status: 'STAGED', text: `${sev}-severity finding ${category} at ${at}. Stage path: ${stagePath}`, reversibility: 'high' };
  }
  if (stagePath != null) return { error: '--stage-path is not valid with --route kept-prompt' };
  if (commit != null) return { error: '--commit is not valid with --route kept-prompt' };
  return { status: 'KEPT-PROMPT', text: `critical finding ${category} at ${at}. Surfaced inline`, reversibility: 'high' };
}

module.exports = { composeRoutingLine, ROUTES, SEVERITIES, ROUTING_STEP, ALLOWED_SEVERITIES };
