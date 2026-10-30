// Compose one /review Step 3 Routing log line (#4488) — pure, no I/O.
// The gate in /claude-tweaks:release Step 3 classifies these lines by the literal
// tokens `critical finding` and `high-severity finding` (blocking) and
// `medium-severity finding` / `low-severity finding` / `applied medium-severity` / `applied low-severity` (findings), so the text is
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
// The other side of a Stacked check (_shared/staged-patch.md) is any site's staged patch, not only review's.
const STACKED_PATCH_RE = /^staged\/[a-z][a-z0-9-]*-\d+\.patch$/;
// bin/check-staged-stack.js's exits that leave the stack unverified (1 is a conflict, --conflict's case).
const STACK_EXITS = ['2', '3', '4'];
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

// A staged patch's non-clean Stacked check outcome (_shared/staged-patch.md) -> { finding, suffix } | { error }:
// `finding` follows the "{sev}-severity finding … at …" lead, `suffix` follows the stage path. Each outcome's wording
// is that file's, with the stage path kept on every line so the console can still read it.
function stackedOutcome({ stagePath, rederivedOnto, conflict, conflictsWith, stackExit, stackStderr }) {
  const given = [rederivedOnto != null, conflict != null || conflictsWith != null, stackExit != null].filter(Boolean).length;
  if (given === 0) {
    if (stackStderr != null) return { error: '--stack-stderr is only valid with --conflict or --stack-exit' };
    return { finding: '', suffix: '' };
  }
  if (given > 1) return { error: 'give one stacked-check outcome: --rederived-onto, --conflict/--conflicts-with, or --stack-exit' };
  if (!/\.patch$/.test(stagePath)) return { error: 'a stacked-check outcome is only valid with a staged/review-{n}.patch --stage-path' };
  if (rederivedOnto != null) {
    if (stackStderr != null) return { error: '--stack-stderr is not valid with --rederived-onto' };
    if (!STACKED_PATCH_RE.test(rederivedOnto) || rederivedOnto === stagePath) {
      return { error: '--rederived-onto must name another staged patch (staged/{slug}-{n}.patch)' };
    }
    return { finding: '', suffix: `. Re-derived onto ${rederivedOnto}` };
  }
  const stderrProblem = textProblem('--stack-stderr', stackStderr);
  if (stderrProblem) return { error: stderrProblem };
  if (stackExit != null) {
    if (!STACK_EXITS.includes(stackExit)) return { error: `--stack-exit must be one of ${STACK_EXITS.join('|')} (exit 1 is a conflict: use --conflict)` };
    return { finding: ` — gate could not run: stacked check exit ${stackExit} (${stackStderr}); kept unstacked — the console's stale path covers a conflict`, suffix: '' };
  }
  if (conflict == null || conflictsWith == null) return { error: '--conflict and --conflicts-with are given together' };
  if (!STACKED_PATCH_RE.test(conflict) || !STACKED_PATCH_RE.test(conflictsWith)) {
    return { error: '--conflict and --conflicts-with must each name a staged patch (staged/{slug}-{n}.patch)' };
  }
  if (conflict !== stagePath && conflictsWith !== stagePath) return { error: '--conflict or --conflicts-with must be the --stage-path patch' };
  return {
    finding: ` — stacked check: ${conflict} does not apply on top of ${conflictsWith} in apply order (${stackStderr}); kept — the console re-derives ${conflict} from its Invariant:`,
    suffix: '',
  };
}

const STACK_FIELDS = ['rederivedOnto', 'conflict', 'conflictsWith', 'stackExit', 'stackStderr'];

// { route, severity, category, at, stagePath?, commit?, lever?, rederivedOnto?, conflict?, conflictsWith?, stackExit?,
// stackStderr? } -> { status, text, reversibility } | { error }.
// `text` never begins with `Step 3 Routing:` (the step prefix is log-decision's to write), so the
// --text repeat refusal never fires on a composed line.
function composeRoutingLine(fields) {
  const { route, severity, category, at, stagePath, commit, lever } = fields;
  if (!ROUTES.includes(route)) return { error: `--route must be one of ${ROUTES.join('|')}` };
  const sev = typeof severity === 'string' ? severity.toLowerCase() : severity;
  if (!SEVERITIES.includes(sev)) return { error: `--severity must be one of ${SEVERITIES.join('|')}` };
  if (!ALLOWED_SEVERITIES[route].includes(sev)) {
    return { error: `--route ${route} does not take --severity ${sev} (allowed: ${ALLOWED_SEVERITIES[route].join('|')})` };
  }
  const problem = textProblem('--category', category) || textProblem('--at', at) || (lever != null ? textProblem('--lever', lever) : null);
  if (problem) return { error: problem };
  if (route !== 'staged' && STACK_FIELDS.some((k) => fields[k] != null)) {
    return { error: `a stacked-check flag is only valid with --route staged` };
  }

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
    const stacked = stackedOutcome(fields);
    if (stacked.error) return { error: stacked.error };
    return { status: 'STAGED', text: `${sev}-severity finding ${category} at ${at}${stacked.finding}. Stage path: ${stagePath}${stacked.suffix}`, reversibility: 'high' };
  }
  if (stagePath != null) return { error: '--stage-path is not valid with --route kept-prompt' };
  if (commit != null) return { error: '--commit is not valid with --route kept-prompt' };
  return { status: 'KEPT-PROMPT', text: `critical finding ${category} at ${at}. Surfaced inline`, reversibility: 'high' };
}

module.exports = { composeRoutingLine, ROUTES, SEVERITIES, ROUTING_STEP, ALLOWED_SEVERITIES };
