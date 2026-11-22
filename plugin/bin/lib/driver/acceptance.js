'use strict';
// The driver's acceptance routing: which acceptance state a finished build gets, decided
// in code from the parent gate's verdict and the oversight floor, never by a worker.
// decideRoute is pure: the caller runs `parent-gate.js --sub-issue N --closing N` and reads
// the record's risk:*/size:* labels, then passes both in.
//
// The closed rule. Exactly these routes; anything else is `route: null` with an `error`:
//   parent-gate state incomplete | gated | resolved        -> try-it-only
//   state due, exceeds === false                           -> try-it-only
//   state due, exceeds === true                            -> due-exceeds (accept:pending on the parent)
//   state no-parent, floor not exceeded                    -> no-parent-exempt
//   state no-parent, floor exceeded (incl. unscored)       -> no-parent-gated (accept:pending on the record)
// A non-zero parent-gate exit, or stdout that did not parse (verdict null), fails open to the
// no-parent rows with `fallback: 'parent-gate failed'` (verification-brief-parent-gate.md,
// "Fail open on every gh call"): never a skip, never `route: null`.
//
// runAcceptance executes the routed state: it reads the route's inputs, launches the read-only
// `acceptance` worker (which returns only tryIt / observationPlan / claims / parentBrief, validated
// here; any labels it returns are never read), and then code does every forge write. Worker text
// reaches a posted body only through `inline` (packet-render.js), line by line, or through the
// packet's own `render`, which owns the narrative's and the observation plan's validation and escaping. It never throws.

const path = require('node:path');
const { exceedsOversightFloor } = require('../issues/oversight-floor');
const { CLI_TIMEOUT_MS } = require('./events');
const { ACCEPTANCE_RESULT_SCHEMA } = require('./roles');
const { bin, isPlainObject, isInterrupted, clock, cleanDetail, emitStep, readRecordAndDiff, launchJudge } = require('./judgment-io');
const { readSection, loadAcceptanceRules, buildAcceptancePrompt } = require('./judgment-prompts');
const { inline, codeSpan } = require('../wrap-up/packet-render');
const { findCredentialInText } = require('../wrap-up/packet-links');
const { findRunComments } = require('../../find-run-comment');
const { isTrustedComment } = require('../issues/comment-trust');
const { parseRecordFacets } = require('../issues/record');
const { LABELS } = require('../issues/record-vocabulary');
const { codeSuffix } = require('./review');

// The successor spelling (#4610): the driver writes `accept:pending`; readers accept either spelling.
const ACCEPT_PENDING = LABELS.ACCEPT_PENDING;
const TRY_IT_STATES = Object.freeze(['incomplete', 'gated', 'resolved']);

function noParentRoute(facets, floors) {
  const { exceeds } = exceedsOversightFloor(facets, floors);
  return exceeds
    ? { route: 'no-parent-gated', labels: [{ on: 'record', label: ACCEPT_PENDING }] }
    : { route: 'no-parent-exempt', labels: [] };
}

// gate: { code, verdict }; facets: { risk, size }; floors: { riskFloor, sizeFloor }
function decideRoute({ gate, facets, floors }) {
  const code = gate ? gate.code : null;
  const verdict = gate ? gate.verdict : null;
  if (code !== 0 || verdict == null) {
    return { ...noParentRoute(facets, floors), fallback: 'parent-gate failed' };
  }
  const { state, exceeds } = verdict;
  if (TRY_IT_STATES.includes(state)) return { route: 'try-it-only', labels: [] };
  if (state === 'due') {
    if (exceeds === false) return { route: 'try-it-only', labels: [] };
    if (exceeds === true) return { route: 'due-exceeds', labels: [{ on: 'parent', label: ACCEPT_PENDING }] };
    return { route: null, error: `parent-gate state due with a non-boolean exceeds (${JSON.stringify(exceeds)})` };
  }
  if (state === 'no-parent') return noParentRoute(facets, floors);
  return { route: null, error: `parent-gate state ${JSON.stringify(state)} is not one of the routed states` };
}

// ---- renderers (pure) ----

const POSTER = 'plugin/bin/drive.js';
const NO_REGISTER = 'No cross-spec promise register — walk the end-to-end path in Try it above.';
const TRY_IT_MARKER = '<!-- run-comment: try-it -->';
const OBSERVATION_KINDS = Object.freeze(['cli', 'flow', 'diff', 'app-route', 'rendered-page']);
const VISUAL_KINDS = Object.freeze(['app-route', 'rendered-page']);
const FLOOR_VALUES = Object.freeze(['low', 'medium', 'high', 'always']);
// The mutation text packet-post.js's EDIT_COMMENT_QUERY carries after its `query=` prefix, which belongs
// to the `-F query=@file` pair here.
const EDIT_COMMENT_MUTATION = 'mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id url}}}';
const LABEL_SPECS = Object.freeze({
  [ACCEPT_PENDING]: { description: "Acceptance: built and verified — awaiting the human's acceptance verdict", color: '006B75' },
});

// _shared/try-it.md's Shape; `heading` is `### Try it` or the end-to-end variant's.
function renderTryIt(groups, heading = '### Try it') {
  const blocks = groups.map((g) => [
    `**${inline(g.name)}**`,
    `- Precondition: ${inline(g.precondition)}`,
    `- Access: ${inline(g.access)}`,
    `- Entry point: ${inline(g.entryPoint)}`,
    '- Steps:',
    ...g.steps.map((step, i) => `  ${i + 1}. ${inline(step)}`),
    `- Expected: ${inline(g.expected)}`,
  ].join('\n'));
  return [heading, '', blocks.join('\n\n')].join('\n');
}

// _shared/observation-plan.md's Schema lines. The values go in raw: the packet's `render` escapes plan
// text and keeps a whole backtick span as a code span, because /claude-tweaks:accept reads this text and runs
// the Prepare commands. Only line breaks are collapsed here, per value, so a value cannot add list lines.
function renderObservationPlan(plan) {
  const one = (v) => String(v).replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? ' ' : run)).trim();
  const list = (label, items) => (items.length === 0 ? [`- ${label}: none`] : [`- ${label}:`, ...items.map((item) => `  - ${one(item)}`)]);
  return [
    '### Observation plan',
    `- Surface: ${one(plan.kind)}`,
    `- Entry point: ${one(plan.entryPoint)}`,
    ...list('Prepare', plan.prepare),
    ...list('Inspect', plan.inspect),
  ].join('\n');
}

// The parent gate's brief (verification-brief-parent-gate.md, "Compose the parent brief"), minus the
// Observation plan a parent omits. `confirmed` is the driver-composed rows, one line each.
function renderParentBrief(brief, { confirmed, poster }) {
  return [
    '## Verification Brief', '',
    '### The ask', inline(brief.ask), '',
    '### What shipped', inline(brief.whatShipped), '',
    renderTryIt(brief.tryItEndToEnd, '### Try it — end to end'), '',
    '### Confirmed', ...confirmed.map(inline), '',
    '---', '',
    `_Posted by ${codeSpan(poster)}. Resolve with \`/claude-tweaks:accept\`._`,
  ].join('\n');
}

// One line per `## Cross-Spec Promises` table row of the parent body, else the no-register line.
function confirmedLines(parentBody) {
  const section = readSection(String(parentBody || ''), '## Cross-Spec Promises');
  const rows = [];
  for (const line of section === null ? [] : section.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('|')) continue;
    const cells = text.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.length < 4 || cells[0] === '#' || /^[-:\s]+$/.test(cells[0])) continue;
    const open = cells[3].toLowerCase() === 'open';
    rows.push(`${cells[0]}: ${cells[1]} — confirm it holds (owner ${cells[2]}, ${cells[3]}${open ? ', unverified' : ''}).`);
  }
  return rows.length > 0 ? rows : [NO_REGISTER];
}

// ---- worker output validation ----

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// null when `groups` is a non-empty array of well-formed Try it groups, else the first violation.
function groupsError(groups, field) {
  if (!Array.isArray(groups) || groups.length === 0) return `${field} is not a non-empty array`;
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    const at = `${field}[${i}]`;
    if (!isPlainObject(g)) return `${at} is not an object`;
    for (const key of ['name', 'precondition', 'access', 'entryPoint', 'expected']) {
      if (!nonEmpty(g[key])) return `${at}.${key} is not a non-empty string`;
    }
    if (!Array.isArray(g.steps) || g.steps.length === 0 || !g.steps.every(nonEmpty)) return `${at}.steps is not a non-empty array of non-empty strings`;
  }
  return null;
}

function planError(plan) {
  if (!isPlainObject(plan)) return 'observationPlan is not an object';
  if (!OBSERVATION_KINDS.includes(plan.kind)) return 'observationPlan.kind is not one of cli, flow, diff, app-route, rendered-page';
  if (!nonEmpty(plan.entryPoint)) return 'observationPlan.entryPoint is not a non-empty string';
  for (const key of ['prepare', 'inspect']) {
    if (!Array.isArray(plan[key]) || !plan[key].every(nonEmpty)) return `observationPlan.${key} is not an array of non-empty strings`;
  }
  // observation-plan.md: Inspect is optional only for the `diff` floor.
  if (plan.kind !== 'diff' && plan.inspect.length === 0) return `observationPlan.inspect needs at least one pointer for kind ${plan.kind}`;
  return null;
}

// The end-to-end variant: tryIt-shaped groups whose every step names the sub-issue it exercises.
function endToEndError(groups) {
  const shape = groupsError(groups, 'parentBrief.tryItEndToEnd');
  if (shape) return shape;
  for (const [i, g] of groups.entries()) {
    const bare = g.steps.findIndex((s) => !/\(#\d+\)\s*$/.test(s));
    if (bare !== -1) return `parentBrief.tryItEndToEnd[${i}].steps[${bare}] has no (#N) suffix`;
  }
  return null;
}

// { stop } naming the first violated field of the route's worker output, else null. `endToEnd` is true
// when the route also owes the end-to-end Try it variant (the parent gate is `due`).
function validateResult(route, result, endToEnd) {
  const bad = (error) => ({ stop: `worker ${error}` });
  const tryIt = groupsError(result.tryIt, 'tryIt');
  if (tryIt) return bad(`tryIt invalid: ${tryIt}`);
  if (endToEnd) {
    const b = result.parentBrief;
    if (!isPlainObject(b)) return bad('parentBrief invalid: parentBrief is not an object');
    if (route === 'due-exceeds' && (!nonEmpty(b.ask) || !nonEmpty(b.whatShipped))) return bad('parentBrief invalid: ask and whatShipped must be non-empty strings');
    const e2e = endToEndError(b.tryItEndToEnd);
    if (e2e) return bad(`parentBrief invalid: ${e2e}`);
  }
  if (route.startsWith('no-parent')) {
    const plan = result.observationPlan;
    if (isPlainObject(plan) && VISUAL_KINDS.includes(plan.kind)) {
      return { stop: `observation plan kind ${plan.kind} needs the visual-review safety net` };
    }
    const planInvalid = planError(plan);
    if (planInvalid) return bad(`observationPlan invalid: ${planInvalid}`);
    if (!Array.isArray(result.claims)) return bad('claims invalid: claims is not an array');
  }
  return null;
}

// ---- credential screen ----

const GROUP_KEYS = Object.freeze(['name', 'precondition', 'access', 'entryPoint', 'expected']);

// Every [field, text] pair of well-formed Try it groups (validateResult ran first).
function* groupTexts(groups, field) {
  for (const [i, g] of groups.entries()) {
    for (const key of GROUP_KEYS) yield [`${field}[${i}].${key}`, g[key]];
    for (const [j, step] of g.steps.entries()) yield [`${field}[${i}].steps[${j}]`, step];
  }
}

// { stop } naming the post step and the first worker field that carries a credential-shaped value (the
// field, never the value), else null. The parent routes post worker text directly, so it is screened here
// the way the no-parent packet's validator and render screen it. Nothing has been written when this runs.
// `route` is try-it-only (the end-to-end groups are posted only when the parent gate is `due`, i.e. `endToEnd`)
// or due-exceeds (the brief's own fields too).
function screenWorkerText(result, route, endToEnd) {
  const briefStep = route === 'due-exceeds' ? 'parent brief post' : 'try-it post';
  const pairs = [];
  if (route === 'due-exceeds') {
    pairs.push(['parent brief post', 'parentBrief.ask', result.parentBrief.ask], ['parent brief post', 'parentBrief.whatShipped', result.parentBrief.whatShipped]);
  }
  if (endToEnd) for (const [field, text] of groupTexts(endToEnd, 'parentBrief.tryItEndToEnd')) pairs.push([briefStep, field, text]);
  for (const [field, text] of groupTexts(result.tryIt, 'tryIt')) pairs.push(['try-it post', field, text]);
  const hit = pairs.find(([, , text]) => findCredentialInText(text));
  return hit ? { stop: `${hit[0]}: a credential-shaped value was withheld (${hit[1]})` } : null;
}

// ---- execution ----

// A step's exit named for the detail; a throw or a null status (a killed child) is named too.
const exitText = (step, r) => {
  if (r && Number.isInteger(r.code)) return `${step} exit ${r.code}`;
  return r && r.threw ? `${step} did not run (the call threw)` : `${step} ended without an exit status`;
};

// A plugin/bin CLI through deps.node. A throw comes back as { threw: true } so the caller names its step.
function cli(env, script, args, cwd) {
  try {
    return env.deps.node(bin(script), args, { cwd, timeout: CLI_TIMEOUT_MS, env: env.deps.env });
  } catch {
    return { threw: true };
  }
}

function readFloors(env, ctx) {
  const r = cli(env, 'resolve-policy.js', ['--run', ctx.runDir, '--values', 'risk-floor', 'size-floor'], ctx.worktree);
  const lines = r && r.code === 0 ? String(r.stdout).trim().split(/\r?\n/).map((l) => l.trim()) : [];
  if (lines.length !== 2 || !lines.every((l) => FLOOR_VALUES.includes(l))) return { stop: `policy floors unreadable (${exitText('resolve-policy', r)})` };
  return { floors: { riskFloor: lines[0], sizeFloor: lines[1] } };
}

function readFacets({ deps }, ctx) {
  try {
    const rec = JSON.parse(deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'labels']));
    if (!isPlainObject(rec) || !Array.isArray(rec.labels)) throw new Error('shape');
    const { risk, size } = parseRecordFacets(rec.labels);
    return { facets: { risk, size } };
  } catch {
    return { stop: 'record labels unreadable (facets)' };
  }
}

function readGate(env, ctx) {
  const n = String(ctx.record);
  const r = cli(env, 'parent-gate.js', ['--sub-issue', n, '--closing', n, '--backend', 'github-issues'], ctx.worktree);
  let verdict = null;
  if (r && r.code === 0) {
    try {
      verdict = JSON.parse(r.stdout);
    } catch {
      verdict = null;
    }
  }
  return { code: r && Number.isInteger(r.code) ? r.code : null, verdict };
}

function writeText({ deps }, file, text, what) {
  try {
    deps.writeFile(file, text);
    return null;
  } catch {
    return { stop: `${what} file not written` };
  }
}

// Rules, prompt, launch, validate. { result } or { stop }. `extra` carries the route's own prompt inputs;
// `endToEnd` marks a route that also owes the end-to-end Try it variant (the parent gate is `due`).
// `preRead` is a record-and-diff read the route already made, handed over so the record is read once.
async function judge(env, ctx, route, extra, endToEnd = false, preRead = null) {
  const rules = loadAcceptanceRules(env.readFile, route);
  if (!rules.ok) return { stop: `skill section missing: ${rules.missing}` };
  const inputs = preRead || readRecordAndDiff(env.deps, ctx, { files: true });
  if (inputs.stop) return inputs;
  const prompt = buildAcceptancePrompt({ route, record: ctx.record, ...inputs, ...extra, endToEnd, rules: rules.text });
  const launched = await launchJudge(env, ctx, {
    role: 'acceptance', dir: 'acceptance-worker', label: 'acceptance worker', prompt, schema: ACCEPTANCE_RESULT_SCHEMA,
  });
  if (launched.stop) return launched;
  // Every return from here on follows a launch that returned, so each carries its model (#5917) and effort (#5942).
  const { envelope, model, effort } = launched;
  if (isInterrupted(env.deps)) return { stop: 'interrupted', model, effort };
  if (!envelope || envelope.status !== 'ok' || !isPlainObject(envelope.result)) return { stop: 'acceptance worker returned no valid result', model, effort };
  const invalid = validateResult(route, envelope.result, endToEnd);
  return invalid ? { ...invalid, model, effort } : { result: envelope.result, body: inputs.body, model, effort };
}

// The verdict's parent: { read } with its title, body and comments, or { stop }.
function readParent({ deps }, ctx, verdict) {
  const parent = verdict.parent;
  if (!Number.isSafeInteger(parent) || parent <= 0) return { stop: 'parent read failed: the verdict names no parent' };
  try {
    const read = JSON.parse(deps.gh(['issue', 'view', String(parent), '--repo', ctx.repo, '--json', 'title,body,comments']));
    if (!isPlainObject(read)) throw new Error('shape');
    return { parent, read };
  } catch {
    return { stop: 'parent read failed' };
  }
}

const parentInputs = (read, verdict) => ({
  parent: { title: String(read.title ?? ''), body: String(read.body ?? '') },
  subIssues: Array.isArray(verdict.subIssues) ? verdict.subIssues : [],
});

// Check-then-create (_shared/label-bootstrap.md) for a label the route applies.
function ensureLabel({ deps }, ctx, name) {
  const spec = LABEL_SPECS[name];
  if (!spec) return { stop: `label ${name} has no bootstrap spec` };
  try {
    const present = JSON.parse(deps.gh(['label', 'list', '--repo', ctx.repo, '--search', name, '--json', 'name', '--limit', '100']));
    if (!Array.isArray(present)) throw new Error('shape');
    if (!present.some((l) => l && l.name === name)) {
      deps.gh(['label', 'create', name, '--repo', ctx.repo, '--description', spec.description, '--color', spec.color]);
    }
    return null;
  } catch {
    return { stop: `label ${name} bootstrap failed` };
  }
}

// The `try-it` PR run comment: update the trusted one in place, else create it. On a `due` parent gate
// `endToEnd` is appended after the record's own block, so both post in one comment.
function postTryIt(env, ctx, state, groups, endToEnd, tmp) {
  const { deps } = env;
  const bodyFile = path.join(tmp, 'try-it.md');
  const blocks = [renderTryIt(groups), ...(endToEnd ? [renderTryIt(endToEnd, '### Try it — end to end')] : [])];
  const failed = writeText(env, bodyFile, `${TRY_IT_MARKER}\n\n${blocks.join('\n\n')}\n`, 'try-it body');
  if (failed) return failed;
  let found;
  try {
    found = findRunComments(JSON.parse(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', 'comments'])), 'try-it');
    if (found === null) throw new Error('shape');
  } catch {
    return { stop: 'try-it post: gh pr view failed' };
  }
  state.skipped += found.skipped.length;
  if (found.id !== null) {
    const queryFile = path.join(tmp, 'edit-comment.graphql');
    const wrote = writeText(env, queryFile, EDIT_COMMENT_MUTATION, 'try-it mutation');
    if (wrote) return wrote;
    try {
      deps.gh(['api', 'graphql', '-F', `query=@${queryFile}`, '-f', `id=${found.id}`, '-F', `body=@${bodyFile}`]);
    } catch {
      return { stop: 'try-it post: gh api graphql failed' };
    }
    return null;
  }
  try {
    deps.gh(['pr', 'comment', String(ctx.pr), '--repo', ctx.repo, '--body-file', bodyFile]);
  } catch {
    return { stop: 'try-it post: gh pr comment failed' };
  }
  return null;
}

const labelsOn = (decision, on) => decision.labels.filter((l) => l.on === on).map((l) => l.label);

// { stop } for the first label that could not be bootstrapped, else null.
function ensureLabels(env, ctx, names) {
  for (const name of names) {
    const bootstrapped = ensureLabel(env, ctx, name);
    if (bootstrapped) return bootstrapped;
  }
  return null;
}

// Records the launch's model and effort on the lane's state once a judge call resolved a model (#5917, #5942).
function noteLaunch(state, judged) {
  if (judged.model) {
    state.model = judged.model;
    state.effort = judged.effort ?? null;
  }
}

// try-it-only: the record's Try it, plus the end-to-end variant when the parent gate is `due` below the floor.
async function tryItOnly(env, ctx, state, decision, verdict, tmp) {
  if (verdict.state !== 'due') {
    const judged = await judge(env, ctx, decision.route, {});
    noteLaunch(state, judged);
    if (judged.stop) return judged;
    const screened = screenWorkerText(judged.result, decision.route, null);
    if (screened) return screened;
    return postTryIt(env, ctx, state, judged.result.tryIt, null, tmp) || {};
  }
  const parent = readParent(env, ctx, verdict);
  if (parent.stop) return parent;
  const judged = await judge(env, ctx, decision.route, parentInputs(parent.read, verdict), true);
  noteLaunch(state, judged);
  if (judged.stop) return judged;
  const screened = screenWorkerText(judged.result, decision.route, judged.result.parentBrief.tryItEndToEnd);
  if (screened) return screened;
  return postTryIt(env, ctx, state, judged.result.tryIt, judged.result.parentBrief.tryItEndToEnd, tmp) || {};
}

async function dueExceeds(env, ctx, state, decision, verdict, tmp) {
  const { deps } = env;
  const found = readParent(env, ctx, verdict);
  if (found.stop) return found;
  const { parent, read } = found;
  const judged = await judge(env, ctx, decision.route, parentInputs(read, verdict), true);
  noteLaunch(state, judged);
  if (judged.stop) return judged;
  const screened = screenWorkerText(judged.result, decision.route, judged.result.parentBrief.tryItEndToEnd);
  if (screened) return screened;
  const labels = labelsOn(decision, 'parent');
  const bootstrapped = ensureLabels(env, ctx, labels);
  if (bootstrapped) return bootstrapped;
  const comments = Array.isArray(read.comments) ? read.comments : [];
  const isBrief = (c) => c && typeof c.body === 'string' && c.body.includes('## Verification Brief') && c.body.includes('### Confirmed');
  state.skipped += comments.filter((c) => isBrief(c) && !isTrustedComment(c)).length;
  const posted = comments.some((c) => isBrief(c) && isTrustedComment(c));
  if (!posted) {
    const briefFile = path.join(tmp, 'parent-brief.md');
    const text = renderParentBrief(judged.result.parentBrief, { confirmed: confirmedLines(read.body), poster: POSTER });
    const failed = writeText(env, briefFile, `${text}\n`, 'parent brief');
    if (failed) return failed;
    try {
      deps.gh(['issue', 'comment', String(parent), '--repo', ctx.repo, '--body-file', briefFile]);
    } catch {
      return { stop: 'parent brief post: gh issue comment failed' };
    }
  }
  for (const name of labels) {
    try {
      deps.gh(['issue', 'edit', String(parent), '--repo', ctx.repo, '--add-label', name]);
    } catch {
      return { stop: `parent label ${name}: gh issue edit failed` };
    }
  }
  return postTryIt(env, ctx, state, judged.result.tryIt, judged.result.parentBrief.tryItEndToEnd, tmp) || {};
}

// The narrative's own claims plus one test-guide claim per Try it step, citing its group's link.
function testGuideClaims(groups) {
  return groups.flatMap((g, n) => g.steps.map((step, i) => ({
    section: 'test-guide',
    text: `${g.name} — step ${i + 1}: ${step} (Precondition: ${g.precondition}; Access: ${g.access}; Expected: ${g.expected})`,
    refs: [`link:entry-point-${n + 1}`],
  })));
}

async function noParent(env, ctx, state, decision, tmp) {
  const files = Object.fromEntries(['facts.json', 'links.json', 'narrative.json', 'plan.md', 'packet.md', 'spec.md'].map((f) => [f.split('.')[0], path.join(tmp, f)]));
  // The record body is the spec on this lane (verification-brief.md's `--spec`): without it the packet's
  // acceptance criteria are not derived. It is read once, before the first gather, so the worker's facts
  // carry the check:ac-* rows it cites; the same read is handed to the worker prompt below.
  const inputs = readRecordAndDiff(env.deps, ctx, { files: true });
  if (inputs.stop) return inputs;
  const specFailed = writeText(env, files.spec, inputs.body, 'spec');
  if (specFailed) return specFailed;
  const gather = (extra) => cli(env, 'acceptance-packet.js', [
    'gather', '--record', String(ctx.record), '--out', files.facts, '--run', ctx.runDir, '--base', `origin/${ctx.base}`, '--head', ctx.head,
    '--spec', files.spec, ...extra, '--surface', 'backend',
  ], ctx.worktree);
  // Two gathers, neither redundant: this first one supplies the facts the worker cites; the second runs
  // after the worker returns, so the links built from its Try it groups (`--links`) can be added to the facts.
  const g1 = gather([]);
  if (!g1 || g1.code !== 0) return { stop: exitText('gather', g1) };
  let facts;
  try {
    facts = JSON.parse(env.readFile(files.facts));
  } catch {
    return { stop: 'gather output unreadable' };
  }
  const judged = await judge(env, ctx, decision.route, { facts }, false, inputs);
  noteLaunch(state, judged);
  if (judged.stop) return judged;
  const { tryIt, observationPlan, claims } = judged.result;
  const links = tryIt.map((g, n) => ({ id: `entry-point-${n + 1}`, label: g.name, command: g.entryPoint }));
  const linksFailed = writeText(env, files.links, JSON.stringify(links), 'links');
  if (linksFailed) return linksFailed;
  const g2 = gather(['--links', files.links]);
  if (!g2 || g2.code !== 0) return { stop: exitText('gather', g2) };
  const narrative = { schemaVersion: 1, claims: [...claims, ...testGuideClaims(tryIt)] };
  const failed = writeText(env, files.narrative, JSON.stringify(narrative), 'narrative')
    || writeText(env, files.plan, `${renderObservationPlan(observationPlan)}\n`, 'observation plan');
  if (failed) return failed;
  const rendered = cli(env, 'acceptance-packet.js', [
    'render', '--facts', files.facts, '--narrative', files.narrative, '--out', files.packet, '--observation-plan', files.plan, '--poster', POSTER,
  ], ctx.worktree);
  if (!rendered || rendered.code !== 0) return { stop: exitText('render', rendered) };
  // A dropped or screened claim means the packet lacks a Try it step (or another claim) the worker wrote:
  // nothing is posted or labelled from a partial packet.
  let counts;
  try {
    counts = JSON.parse(String(rendered.stdout));
  } catch {
    counts = null;
  }
  if (!isPlainObject(counts) || !Number.isInteger(counts.dropped) || !Number.isInteger(counts.screened)) return { stop: 'render output unreadable (no dropped/screened counts)' };
  if (counts.dropped > 0 || counts.screened > 0) return { stop: `render dropped ${counts.dropped} claim(s) and screened ${counts.screened} claim(s); the packet is partial, nothing posted` };
  const labels = labelsOn(decision, 'record');
  const bootstrapped = ensureLabels(env, ctx, labels);
  if (bootstrapped) return bootstrapped;
  const posted = cli(env, 'acceptance-packet.js', [
    'post', '--record', String(ctx.record), '--body-file', files.packet, '--pr', String(ctx.pr), '--repo', ctx.repo,
    ...labels.flatMap((name) => ['--label', name]),
  ], ctx.worktree);
  if (!posted || posted.code !== 0) return { stop: exitText('post', posted) };
  if (decision.route === 'no-parent-exempt') {
    const exempt = cli(env, 'set-verify-expectations.js', ['--run', ctx.runDir, '--oversight-exempt', String(ctx.record)], ctx.mainCheckout);
    if (!exempt || exempt.code !== 0) return { stop: exitText('set-verify-expectations', exempt) };
  }
  return {};
}

async function execute(env, ctx, state) {
  const { deps } = env;
  state.step = 'policy floors';
  const floors = readFloors(env, ctx);
  if (floors.stop) return floors;
  state.step = 'record facets';
  const facets = readFacets(env, ctx);
  if (facets.stop) return facets;
  state.step = 'parent gate';
  const gate = readGate(env, ctx);
  const decision = decideRoute({ gate, facets: facets.facets, floors: floors.floors });
  if (decision.route === null) return { stop: decision.error };
  state.route = decision.route;
  state.step = `route ${decision.route}`;
  const note = decision.fallback ? `; ${decision.fallback}` : '';
  const tmp = path.join(ctx.runDir, 'acceptance');
  try {
    deps.mkdirSync(tmp, { recursive: true });
  } catch {
    return { stop: `acceptance temp dir not created${note}` };
  }
  let out;
  if (decision.route === 'try-it-only') out = await tryItOnly(env, ctx, state, decision, gate.verdict, tmp);
  else if (decision.route === 'due-exceeds') out = await dueExceeds(env, ctx, state, decision, gate.verdict, tmp);
  else out = await noParent(env, ctx, state, decision, tmp);
  return out.stop ? { stop: `${out.stop}${note}` } : { detail: `route ${decision.route} complete${note}` };
}

// The driver's acceptance step: { completed, route, detail }, one `merge-acceptance` event, never throws.
async function runAcceptance(env, ctx) {
  const deps = env && env.deps;
  const startedAt = clock(deps);
  const state = { route: null, skipped: 0, step: 'start' };
  let out;
  try {
    out = await execute(env, ctx, state);
  } catch (err) {
    out = { stop: `acceptance failed unexpectedly at ${state.step}${codeSuffix(err)}` };
  }
  // A signal during the worker launch was already reported by run.js's handler: no event, nothing more.
  if (isInterrupted(deps)) return { completed: false, route: state.route, detail: 'interrupted' };
  const completed = !out.stop;
  // Untrusted marker comments that were not acted on are named, so a planted one is never silent.
  const skipped = state.skipped > 0 ? `; skipped ${state.skipped} untrusted comment(s)` : '';
  const raw = `${completed ? out.detail : out.stop}${skipped}`;
  emitStep(deps, 'merge-acceptance', completed ? 'ok' : 'stop', startedAt, raw, { route: state.route, ...(state.model ? { model: state.model, effort: state.effort ?? null } : {}) });
  return { completed, route: state.route, detail: cleanDetail(raw) };
}

module.exports = { decideRoute, runAcceptance, renderTryIt, renderParentBrief, renderObservationPlan };
