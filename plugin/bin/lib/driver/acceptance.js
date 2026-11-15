'use strict';
// The driver's acceptance routing: which acceptance state a finished build gets, decided
// in code from the parent gate's verdict and the oversight floor, never by a worker.
// decideRoute is pure: the caller runs `parent-gate.js --sub-issue N --closing N` and reads
// the record's risk:*/size:* labels, then passes both in.
//
// The closed rule. Exactly these routes; anything else is `route: null` with an `error`:
//   parent-gate state incomplete | gated | resolved        -> try-it-only
//   state due, exceeds === false                           -> try-it-only
//   state due, exceeds === true                            -> due-exceeds (demo:pending on the parent)
//   state no-parent, floor not exceeded                    -> no-parent-exempt
//   state no-parent, floor exceeded (incl. unscored)       -> no-parent-gated (demo:pending on the record)
// A non-zero parent-gate exit, or stdout that did not parse (verdict null), fails open to the
// no-parent rows with `fallback: 'parent-gate failed'` (verification-brief-parent-gate.md,
// "Fail open on every gh call"): never a skip, never `route: null`.

//
// runAcceptance executes the routed state: it reads the route's inputs, launches the read-only
// `acceptance` worker (which returns only tryIt / observationPlan / claims / parentBrief, validated
// here; any labels it returns are never read), and then code does every forge write. Worker text
// reaches a posted body only through `inline` (packet-render.js), line by line, or through the
// packet's own `render`, which owns the narrative's validation and escaping. It never throws.

const path = require('node:path');
const { exceedsOversightFloor } = require('../issues/oversight-floor');
const { neutralize, CLI_TIMEOUT_MS } = require('./events');
const { readCeilings, launchTracked } = require('./launch');
const { ACCEPTANCE_RESULT_SCHEMA } = require('./roles');
const { readSection, loadAcceptanceRules, buildAcceptancePrompt } = require('./judgment-prompts');
const { inline, codeSpan } = require('../wrap-up/packet-render');
const { findRunComments } = require('../../find-run-comment');
const { isTrustedComment } = require('../issues/comment-trust');
const { parseRecordFacets } = require('../issues/record');

const DEMO_PENDING = 'demo:pending';
const TRY_IT_STATES = Object.freeze(['incomplete', 'gated', 'resolved']);

function noParentRoute(facets, floors) {
  const { exceeds } = exceedsOversightFloor(facets, floors);
  return exceeds
    ? { route: 'no-parent-gated', labels: [{ on: 'record', label: DEMO_PENDING }] }
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
    if (exceeds === true) return { route: 'due-exceeds', labels: [{ on: 'parent', label: DEMO_PENDING }] };
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
const EVENT_DETAIL_MAX = 200;
// The mutation text packet-post.js's EDIT_COMMENT_QUERY carries after its `query=` prefix, which belongs
// to the `-F query=@file` pair here.
const EDIT_COMMENT_MUTATION = 'mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id url}}}';
const LABEL_SPECS = Object.freeze({
  [DEMO_PENDING]: { description: 'Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo', color: '006B75' },
});

// Worker text, one line at a time, through packet-render's inline: no mention, issue reference, live
// link, heading or block opener survives.
function neutralizeLines(text) {
  return String(text).split('\n').map(inline).join('\n');
}

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

// _shared/observation-plan.md's Schema lines.
function renderObservationPlan(plan) {
  const list = (label, items) => (items.length === 0 ? [`- ${label}: none`] : [`- ${label}:`, ...items.map((item) => `  - ${inline(item)}`)]);
  return [
    '### Observation plan',
    `- Surface: ${inline(plan.kind)}`,
    `- Entry point: ${inline(plan.entryPoint)}`,
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
    `_Posted by ${codeSpan(poster)}. Resolve with \`/claude-tweaks:demo\`._`,
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
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
    if (!Array.isArray(plan[key]) || !plan[key].every((s) => typeof s === 'string')) return `observationPlan.${key} is not an array of strings`;
  }
  return null;
}

// { stop } naming the first violated field of the route's worker output, else null.
function validateResult(route, result) {
  const bad = (error) => ({ stop: `worker ${error}` });
  const tryIt = groupsError(result.tryIt, 'tryIt');
  if (tryIt) return bad(`tryIt invalid: ${tryIt}`);
  if (route === 'due-exceeds') {
    const b = result.parentBrief;
    if (!isPlainObject(b)) return bad('parentBrief invalid: parentBrief is not an object');
    if (!nonEmpty(b.ask) || !nonEmpty(b.whatShipped)) return bad('parentBrief invalid: ask and whatShipped must be non-empty strings');
    const e2e = groupsError(b.tryItEndToEnd, 'parentBrief.tryItEndToEnd');
    if (e2e) return bad(`parentBrief invalid: ${e2e}`);
  }
  if (route.startsWith('no-parent')) {
    const plan = planError(result.observationPlan);
    if (plan) return bad(`observationPlan invalid: ${plan}`);
    if (VISUAL_KINDS.includes(result.observationPlan.kind)) {
      return { stop: `observation plan kind ${result.observationPlan.kind} needs the visual-review safety net` };
    }
    if (!Array.isArray(result.claims)) return bad('claims invalid: claims is not an array');
  }
  return null;
}

// ---- execution ----

const BIN_DIR = path.join(__dirname, '..', '..');
const bin = (name) => path.join(BIN_DIR, name);

function clock(deps) {
  try {
    return deps && typeof deps.now === 'function' ? deps.now() : 0;
  } catch {
    return 0;
  }
}

// An emit that throws never changes the result it reports.
function emitEvent(deps, startedAt, completed, route, detail) {
  try {
    if (!deps || typeof deps.emit !== 'function') return;
    deps.emit('merge-acceptance', completed ? 'ok' : 'stop', clock(deps) - startedAt, detail, { route });
  } catch {
    // an event is a report about the step, never part of it
  }
}

const exitText = (step, r) => (r && Number.isInteger(r.code) ? `${step} exit ${r.code}` : `${step} did not run`);

function cli(env, script, args, cwd) {
  return env.deps.node(bin(script), args, { cwd, timeout: CLI_TIMEOUT_MS, env: env.deps.env });
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
  let r = null;
  try {
    r = cli(env, 'parent-gate.js', ['--sub-issue', n, '--closing', n, '--backend', 'github-issues'], ctx.worktree);
  } catch {
    r = null;
  }
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

// The record, the diff and the changed files for the prompt. { stop } on a failed read.
function readRecordInputs({ deps }, ctx) {
  let title;
  let body;
  try {
    const rec = JSON.parse(deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'title,body']));
    if (!isPlainObject(rec)) throw new Error('shape');
    title = String(rec.title ?? '');
    body = String(rec.body ?? '');
  } catch {
    return { stop: 'record read failed' };
  }
  const diffArgs = (flags) => ['-C', ctx.worktree, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', ...flags, '--end-of-options', `origin/${ctx.base}...HEAD`, '--'];
  try {
    const diff = String(deps.git(diffArgs([]), { cwd: ctx.worktree }));
    const changedFiles = String(deps.git(diffArgs(['--name-only']), { cwd: ctx.worktree })).split('\n').filter(Boolean);
    return { title, body, diff, changedFiles };
  } catch {
    return { stop: 'diff read failed' };
  }
}

// Rules, prompt, launch, validate. { result } or { stop }.
async function judge(env, ctx, route, extra) {
  const { deps, shared, readFile } = env;
  const rules = loadAcceptanceRules(readFile, route);
  if (!rules.ok) return { stop: `skill section missing: ${rules.missing}` };
  const inputs = readRecordInputs(env, ctx);
  if (inputs.stop) return inputs;
  const prompt = buildAcceptancePrompt({ route, record: ctx.record, ...inputs, ...extra, rules: rules.text });
  const ceilings = readCeilings(shared.policy);
  if (ceilings.bad) return { stop: 'acceptance worker ceiling is not a positive number' };
  const settingsDir = path.join(ctx.runDir, 'acceptance-worker');
  let envelope;
  try {
    deps.mkdirSync(settingsDir, { recursive: true });
    envelope = await launchTracked(shared, deps, { minutes: ceilings.minutes, dollars: ceilings.dollars }, {
      role: 'acceptance', cwd: ctx.worktree, prompt, schema: ACCEPTANCE_RESULT_SCHEMA, settingsDir,
    });
  } catch {
    return { stop: 'acceptance worker launch failed' };
  }
  if (!envelope || envelope.status !== 'ok' || !isPlainObject(envelope.result)) return { stop: 'acceptance worker returned no valid result' };
  const invalid = validateResult(route, envelope.result);
  return invalid || { result: envelope.result };
}

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

// The `try-it` PR run comment: update the trusted one in place, else create it.
function postTryIt(env, ctx, groups, tmp) {
  const { deps } = env;
  const bodyFile = path.join(tmp, 'try-it.md');
  const failed = writeText(env, bodyFile, `${TRY_IT_MARKER}\n\n${renderTryIt(groups)}\n`, 'try-it body');
  if (failed) return failed;
  let found;
  try {
    found = findRunComments(JSON.parse(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', 'comments'])), 'try-it');
    if (found === null) throw new Error('shape');
  } catch {
    return { stop: 'try-it post: gh pr view failed' };
  }
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

async function tryItOnly(env, ctx, decision, tmp) {
  const judged = await judge(env, ctx, decision.route, {});
  if (judged.stop) return judged;
  return postTryIt(env, ctx, judged.result.tryIt, tmp) || {};
}

async function dueExceeds(env, ctx, decision, verdict, tmp) {
  const { deps } = env;
  const parent = verdict.parent;
  if (!Number.isSafeInteger(parent) || parent <= 0) return { stop: 'parent read failed: the verdict names no parent' };
  let read;
  try {
    read = JSON.parse(deps.gh(['issue', 'view', String(parent), '--repo', ctx.repo, '--json', 'title,body,comments']));
    if (!isPlainObject(read)) throw new Error('shape');
  } catch {
    return { stop: 'parent read failed' };
  }
  const judged = await judge(env, ctx, decision.route, {
    parent: { title: String(read.title ?? ''), body: String(read.body ?? '') },
    subIssues: Array.isArray(verdict.subIssues) ? verdict.subIssues : [],
  });
  if (judged.stop) return judged;
  const labels = labelsOn(decision, 'parent');
  for (const name of labels) {
    const bootstrapped = ensureLabel(env, ctx, name);
    if (bootstrapped) return bootstrapped;
  }
  const comments = Array.isArray(read.comments) ? read.comments : [];
  const posted = comments.some((c) => c && isTrustedComment(c) && typeof c.body === 'string'
    && c.body.includes('## Verification Brief') && c.body.includes('### Confirmed'));
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
  return postTryIt(env, ctx, judged.result.tryIt, tmp) || {};
}

// The narrative's own claims plus one test-guide claim per Try it step, citing its group's link.
function testGuideClaims(groups) {
  return groups.flatMap((g, n) => g.steps.map((step, i) => ({
    section: 'test-guide',
    text: `${g.name} — step ${i + 1}: ${step} (Precondition: ${g.precondition}; Access: ${g.access}; Expected: ${g.expected})`,
    refs: [`link:entry-point-${n + 1}`],
  })));
}

async function noParent(env, ctx, decision, tmp) {
  const files = Object.fromEntries(['facts.json', 'links.json', 'narrative.json', 'plan.md', 'packet.md'].map((f) => [f.split('.')[0], path.join(tmp, f)]));
  const gather = (withLinks) => cli(env, 'acceptance-packet.js', [
    'gather', '--record', String(ctx.record), '--out', files.facts, '--run', ctx.runDir, '--base', `origin/${ctx.base}`, '--head', ctx.head,
    ...(withLinks ? ['--links', files.links] : []), '--surface', 'backend',
  ], ctx.worktree);
  const g1 = gather(false);
  if (!g1 || g1.code !== 0) return { stop: exitText('gather', g1) };
  let facts;
  try {
    facts = JSON.parse(env.readFile(files.facts));
  } catch {
    return { stop: 'gather output unreadable' };
  }
  const judged = await judge(env, ctx, decision.route, { facts });
  if (judged.stop) return judged;
  const { tryIt, observationPlan, claims } = judged.result;
  const links = tryIt.map((g, n) => ({ id: `entry-point-${n + 1}`, label: g.name, command: g.entryPoint }));
  const linksFailed = writeText(env, files.links, JSON.stringify(links), 'links');
  if (linksFailed) return linksFailed;
  const g2 = gather(true);
  if (!g2 || g2.code !== 0) return { stop: exitText('gather', g2) };
  const narrative = { schemaVersion: 1, claims: [...claims, ...testGuideClaims(tryIt)] };
  const failed = writeText(env, files.narrative, JSON.stringify(narrative), 'narrative')
    || writeText(env, files.plan, `${renderObservationPlan(observationPlan)}\n`, 'observation plan');
  if (failed) return failed;
  const rendered = cli(env, 'acceptance-packet.js', [
    'render', '--facts', files.facts, '--narrative', files.narrative, '--out', files.packet, '--observation-plan', files.plan, '--poster', POSTER,
  ], ctx.worktree);
  if (!rendered || rendered.code !== 0) return { stop: exitText('render', rendered) };
  const labels = labelsOn(decision, 'record');
  for (const name of labels) {
    const bootstrapped = ensureLabel(env, ctx, name);
    if (bootstrapped) return bootstrapped;
  }
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
  const floors = readFloors(env, ctx);
  if (floors.stop) return floors;
  const facets = readFacets(env, ctx);
  if (facets.stop) return facets;
  const gate = readGate(env, ctx);
  const decision = decideRoute({ gate, facets: facets.facets, floors: floors.floors });
  if (decision.route === null) return { stop: decision.error };
  state.route = decision.route;
  const note = decision.fallback ? `; ${decision.fallback}` : '';
  const tmp = path.join(ctx.runDir, 'acceptance');
  try {
    deps.mkdirSync(tmp, { recursive: true });
  } catch {
    return { stop: `acceptance temp dir not created${note}` };
  }
  let out;
  if (decision.route === 'try-it-only') out = await tryItOnly(env, ctx, decision, tmp);
  else if (decision.route === 'due-exceeds') out = await dueExceeds(env, ctx, decision, gate.verdict, tmp);
  else out = await noParent(env, ctx, decision, tmp);
  return out.stop ? { stop: `${out.stop}${note}` } : { detail: `route ${decision.route} complete${note}` };
}

// The driver's acceptance step: { completed, route, detail }, one `merge-acceptance` event, never throws.
async function runAcceptance(env, ctx) {
  const deps = env && env.deps;
  const startedAt = clock(deps);
  const state = { route: null };
  let out;
  try {
    out = await execute(env, ctx, state);
  } catch {
    out = { stop: 'acceptance failed unexpectedly' };
  }
  const completed = !out.stop;
  const detail = neutralize(String(completed ? out.detail : out.stop)).slice(0, EVENT_DETAIL_MAX);
  emitEvent(deps, startedAt, completed, state.route, detail);
  return { completed, route: state.route, detail };
}

module.exports = { decideRoute, runAcceptance, renderTryIt, renderParentBrief, renderObservationPlan, neutralizeLines };
