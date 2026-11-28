// plugin/bin/lib/ci-audit/issue-payload.js — projects a validated /claude-tweaks:ci-health
// (#5757) finding into a born-ready work-record payload. Emit-only: no spawns, no I/O; the skill
// files the payload. Label, marker and type assembly is recordPayload's and the body is
// specShapedBody's (bin/lib/issues/record.js), as docs-health's payload does: origin ci-health,
// risk:low, size:low, ready, Type task, the `work-fingerprint` marker carrying the finding's id.
//
// toIssuePayload(finding, gather, verifiedAsOf) -> { id, check, workflow, job, step, origin, title,
// body, labels, type }. `finding` is validateFinding's value plus its fingerprint `id`; `gather` is
// the report it was validated against (the window, the breach thresholds, truncation);
// `verifiedAsOf` is a commit sha the caller read, or null to omit the stamp.
//
// Body:
//  - Current State: the window (days, first day, sampled runs, the minimum sample a check needs),
//    each cited figure, the judge's claim verbatim in a fenced block, and — only when the gather
//    has truncated lines (each one a cut that could have changed the sample) or failed reads —
//    that the sample is partial, naming each (failed reads: the first FAILURE_LINES, then a count).
//  - Deliverables: the judge's remedy verbatim in a fenced block, as a recommendation to
//    investigate and apply where it holds; never an instruction to edit a named file.
//  - Acceptance Criteria: the gather breach's metric back under its threshold on the next sweep
//    ("at or below" for a ratio check, "below" for repeated-work, which fires at its threshold), or,
//    for a check with no numeric threshold or no breach in the gather, the check reporting no
//    breach for the subject.
//  - Release Note: RELEASE_NOTE. No Key Files section: a timing finding changes no repo file.
// Untrusted text — every workflow, job and step name, the claim, the remedy, the gather's
// truncation and failure lines — renders only inside a code span (codeSpan) or a fenced block
// (fencedBlock), each sized past the text's longest backtick run, and is first defused so it
// cannot spell a fingerprint marker. A truncation or failure line carrying credential-shaped text
// is withheld. A repeated-work finding has workflow null (the step spans every workflow), so its
// header and title name the step and no workflow. The title is capped at TITLE_CAP characters.
'use strict';

const { recordPayload, specShapedBody, fencedBlock, defuse } = require('../issues/record');
const { codeSpan } = require('../wrap-up/packet-render');
const { findCredentialInText } = require('../wrap-up/packet-links');
const { DEFAULTS } = require('./checks');

const RELEASE_NOTE = 'No user-visible change — CI timing finding.';
const ORIGIN = 'ci-health';
const TITLE_CAP = 200;
const FAILURE_LINES = 20;

const span = (v) => codeSpan(defuse(String(v)));
const block = (v) => fencedBlock(defuse(v));
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function subjectOf(f) {
  if (f.check === 'repeated-work') return `step ${span(f.step)}`;
  return `workflow ${span(f.workflow)}${f.job === null ? '' : ` job ${span(f.job)}`}`;
}

function evidenceLine(ev, f) {
  let who;
  if (f.check === 'repeated-work' && ev.job === null && ev.metric === 'jobsDeclaringStep') who = `step ${span(f.step)}`;
  else who = ev.job === null ? `workflow ${span(f.workflow)}` : `job ${span(ev.job)}`;
  return `- ${span(ev.metric)} of ${who}: ${span(ev.value)}`;
}

function currentState(f, g) {
  const w = g.window || {};
  const from = typeof w.from === 'string' ? ` from ${span(w.from)}` : '';
  const parts = [
    `Measured over the ${w.days}-day window${from}: ${span(w.sampledRuns)} sampled runs, a job judged at ${span(w.minSample)} runs or more.`,
    f.evidence.map((ev) => evidenceLine(ev, f)).join('\n'),
    'The finding, as the judge wrote it:',
    block(f.claim),
  ];
  const screened = (lines, what) => strings(lines).map((line) => (findCredentialInText(line) === null
    ? line : `(${what} whose text looks like a credential, withheld)`));
  const truncated = screened(g.truncated, 'a truncated range');
  const failures = screened(g.failures, 'a failed read');
  if (truncated.length > 0 || failures.length > 0) {
    parts.push(`The sample is partial: some reads were cut short or failed, so these figures cover only the runs read.${truncated.length > 0 ? ' Truncated:' : ''}`);
    if (truncated.length > 0) parts.push(block(truncated.join('\n')));
    // One failed read per sampled run can pile up: show the first FAILURE_LINES, count the rest.
    const shown = failures.slice(0, FAILURE_LINES);
    if (failures.length > FAILURE_LINES) shown.push(`+${failures.length - FAILURE_LINES} more failed reads`);
    if (failures.length > 0) parts.push('Failed reads:', block(shown.join('\n')));
  }
  return parts;
}

function acceptanceCriteria(f, g) {
  const breaches = Array.isArray(g.breaches) ? g.breaches.filter((b) => b && typeof b === 'object') : [];
  const b = f.check === 'repeated-work'
    ? breaches.find((x) => x.check === f.check && x.step === f.step)
    : breaches.find((x) => x.check === f.check && x.workflow === f.workflow && x.job === f.job);
  const subject = subjectOf(f);
  if (!b || !Object.prototype.hasOwnProperty.call(DEFAULTS, f.check) || typeof b.threshold !== 'number') {
    return `On the next sweep, the ${f.check} check reports no breach for ${subject}.`;
  }
  const cmp = f.check === 'repeated-work' ? 'below' : 'at or below';
  return `On the next sweep, ${span(b.metric)} for ${subject} is ${cmp} ${span(b.threshold)}, the ${f.check} threshold.`;
}

// `CI <check>: <names>`, at most TITLE_CAP characters (UTF-16 code units, `.length`). Names are cut
// last first (step or job, then workflow) to whole code points plus an ellipsis, inside their own
// code span, so the check id prefix and the span's backticks stay intact. The cut keeps the most
// code points that fit: a binary search over the kept count, measured in the cap's own unit, so an
// astral character or a backtick run (which widens the span's fence) never over-cuts.
function titleOf(f) {
  const segments = [];
  if (f.workflow !== null) segments.push([' ', f.workflow]);
  if (f.job !== null) segments.push([' — ', f.job]);
  if (f.step !== null) segments.push([segments.length === 0 ? ' step ' : ' — step ', f.step]);
  const texts = segments.map(([, t]) => String(t));
  const render = () => `CI ${f.check}:${segments.map(([lead], i) => lead + span(texts[i])).join('')}`;
  for (let i = segments.length - 1; i >= 0 && render().length > TITLE_CAP; i--) {
    const points = [...String(segments[i][1])];
    const fits = (keep) => { texts[i] = `${points.slice(0, keep).join('')}…`; return render().length <= TITLE_CAP; };
    let lo = 0; // the most code points known to fit (or 0)
    let hi = points.length - 1; // a cut always drops at least one
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid; else hi = mid - 1;
    }
    fits(lo);
  }
  return render();
}

function toIssuePayload(finding, gather, verifiedAsOf) {
  const f = { ...finding, workflow: finding.workflow ?? null, job: finding.job ?? null, step: finding.step ?? null };
  const g = gather && typeof gather === 'object' ? gather : {};
  const header = `**Check:** ${span(f.check)}`
    + (f.workflow === null ? '' : ` | **Workflow:** ${span(f.workflow)}`)
    + (f.job === null ? '' : ` | **Job:** ${span(f.job)}`)
    + (f.step === null ? '' : ` | **Step:** ${span(f.step)}`);
  const body = specShapedBody({
    header,
    currentState: currentState(f, g),
    deliverables: ['Investigate this recommendation and apply it where it holds:', block(f.remedy)],
    acceptanceCriteria: acceptanceCriteria(f, g),
    releaseNote: RELEASE_NOTE,
    filedBy: '/claude-tweaks:ci-health',
    verifiedAsOf: verifiedAsOf || undefined,
  });
  const title = titleOf(f);
  const payload = recordPayload({
    title, body, type: 'task', origin: ORIGIN, risk: 'low', size: 'low', ready: true, fingerprint: f.id,
  });
  return {
    id: f.id,
    check: f.check,
    workflow: f.workflow,
    job: f.job,
    step: f.step,
    origin: ORIGIN,
    title: payload.title,
    body: payload.body,
    labels: payload.labels,
    type: payload.type,
  };
}

module.exports = { toIssuePayload, RELEASE_NOTE };
