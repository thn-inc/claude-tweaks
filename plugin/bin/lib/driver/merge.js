'use strict';
// The pipeline driver's merge step (#5226): takes a record whose live labels carry `auto:merge`
// from a green draft PR to a merged one, in program code, with no model call. The one judgment
// the lane needs (the merge-check verdict and the acceptance state) arrives only through the
// optional `deps.judgments` supplier; with none configured the step changes nothing.
//
// Ported procedure, by section: `_shared/pr-first-merge.md` Steps 2 to 3,
// `_shared/pr-first-merge-post-merge.md` Steps 4 and 5, and `_shared/express-lane.md` step 9.
// No test reads that prose, and drift between it and this module is accepted by design (the
// spec's Gotchas); each step function's comment names the section it ports, by symbol.
//
// Every external call except the decisions.md read (`confirmFromFile`, in-process, spec AC3)
// goes through `deps` (gh, git, node, readFile, lstatType, ...), so this module spawns nothing
// itself. `merge` never throws: an unexpected throw in any step becomes
// `pending-review` / `unclassified` naming the sub-step.

const path = require('node:path');
const {
  neutralize, errorText, firstLine, CLI_TIMEOUT_MS, MERGE_STEP_NAMES,
} = require('./events');
const { reduceDetail } = require('./settle');
const { confirmFromFile } = require('../dispatch/merge-verdict');

const BIN_DIR = path.join(__dirname, '..', '..');
const AUTHORIZING_LABEL = 'auto:merge';

function bin(name) {
  return path.join(BIN_DIR, name);
}

// One event per sub-step call. An emit that throws never breaks the step it describes.
function emit(s, step, status, detail, extra) {
  if (!MERGE_STEP_NAMES.includes(step)) throw new Error(`unknown merge step name: ${step}`);
  if (typeof s.deps.emit !== 'function') return;
  const ms = typeof s.deps.now === 'function' ? s.deps.now() - s.startedAt : 0;
  try {
    s.deps.emit(step, status, ms, neutralize(String(detail || '')), extra);
  } catch {
    // an event is a report about the step, never part of it
  }
}

function stop(s, step, reason, detail) {
  emit(s, step, 'stop', `${reason}: ${detail || ''}`.trim());
  return { stop: reason, detail: neutralize(String(detail || '')) };
}

// Appends one decision line through log-decision.js, the text in a file in the run directory
// first (--text-file), mirroring steps.js's logDecisionFile. A failed log never stops the
// merge: it is recorded on s.logFailures and named in the sub-step's event.
function logDecision(s, step, text, status = 'AUTO', reversibility = null) {
  const { ctx, deps } = s;
  s.logSeq += 1;
  const file = path.join(s.runDir, `merge-log-${s.logSeq}.txt`);
  try {
    deps.writeFile(file, `${text}\n`);
    const r = deps.node(bin('log-decision.js'),
      ['--run', s.runDir, '--status', status, '--section', '/express-lane', '--step', step, '--text-file', file,
        ...(reversibility ? ['--reversibility', reversibility] : [])],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
    if (r.code !== 0) s.logFailures.push(`log:${step}`);
  } catch {
    s.logFailures.push(`log:${step}`);
  }
}

// Ports pr-first-merge.md Step 2 (the live label read): `auto:merge` is the authorization,
// read from GitHub now, not from a cached copy. `auto:merge-pending` does not count.
function readLabels(s) {
  const { ctx, deps } = s;
  let raw;
  try {
    raw = deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'labels']);
  } catch (err) {
    return { unreadable: `label read failed: ${errorText(err)}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { unreadable: 'label read returned unparseable output' };
  }
  const labels = parsed && parsed.labels;
  if (!Array.isArray(labels) || !labels.every((l) => l && typeof l === 'object' && typeof l.name === 'string')) {
    return { unreadable: 'label read returned no label list' };
  }
  return { names: labels.map((l) => l.name) };
}

function isPositiveInteger(n) {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

// Ports pr-first-merge.md Step 2's entry condition: the run resolves `integration-model` to
// `pr-first` and run-state.json carries the PR the run opened. Any failure of this read is a
// stop (`not-pr-first`); the lever read below is a separate call so it never decides this one.
function readIntegrationModel(s) {
  const { ctx, deps } = s;
  const r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, '--values', 'integration-model'],
    { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  if (r.code !== 0 || String(r.stdout).trim() !== 'pr-first') {
    return `integration-model did not resolve pr-first (${r.code === 0 ? neutralize(String(r.stdout).trim()) || 'empty' : `exit ${r.code}`})`;
  }
  let state;
  try {
    state = JSON.parse(deps.readFile(path.join(s.runDir, 'run-state.json')));
  } catch (err) {
    return `run-state.json unreadable: ${errorText(err)}`;
  }
  if (!state || typeof state !== 'object' || !state.pr || !isPositiveInteger(state.pr.number)) {
    return 'run-state.json carries no pr number';
  }
  return null;
}

// Ports pr-first-merge.md Step 3's lever read (merge-verification). Never a stop: every failure
// of the read, and the value `off`, runs as `wait`. The JSON form of the `--values` read, so the
// source rides along for the `--lever` log field.
function readLever(s) {
  const { ctx, deps } = s;
  const r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, 'merge-verification'],
    { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  let raw = '';
  let source = 'unresolved';
  if (r.code === 0) {
    try {
      const parsed = JSON.parse(r.stdout);
      const entry = parsed && typeof parsed === 'object' ? parsed['merge-verification'] : undefined;
      if (entry && typeof entry === 'object' && !entry.error && typeof entry.value === 'string') {
        raw = entry.value;
        source = entry.source || 'unresolved';
      }
    } catch {
      // unparseable: stays unresolved
    }
  }
  s.valueRaw = raw;
  s.source = source;
  s.value = raw === 'merge-when-green' ? 'merge-when-green' : 'wait';
  if (raw === 'off') {
    logDecision(s, 'Step 2.5', 'lever off is not ported on the driver lane — proceeding as wait');
  } else if (raw !== 'merge-when-green' && raw !== 'wait') {
    logDecision(s, 'Step 2.5', `lever unresolved ("${neutralize(raw)}") — proceeding as wait`);
  }
}

// Ports the express-lane.md step 9 judgment inputs: the supplier's merge-check verdict and
// acceptance state, then pr-first-merge.md Step 2's backstop, decisions.md's own verdict line
// (the latest line per record wins, so a later needs-human beats an earlier auto-merge).
async function consultSupplier(s) {
  const { ctx, deps } = s;
  let j;
  try {
    j = await deps.judgments(ctx);
  } catch (err) {
    return stop(s, 'merge-supplier', 'supplier-failed', `judgments threw: ${errorText(err)}`);
  }
  const mc = j && typeof j === 'object' ? j.mergeCheck : null;
  const ac = j && typeof j === 'object' ? j.acceptance : null;
  if (!mc || typeof mc.verdict !== 'string' || !ac || typeof ac.completed !== 'boolean') {
    return stop(s, 'merge-supplier', 'supplier-failed', 'judgments returned an unusable shape');
  }
  if (mc.verdict !== 'auto-merge') {
    return stop(s, 'merge-supplier', 'verdict-not-confirmed', `supplier verdict ${neutralize(mc.verdict) || 'empty'}`);
  }
  if (ac.completed !== true) {
    return stop(s, 'merge-supplier', 'acceptance-not-completed', 'acceptance not completed');
  }
  const confirm = confirmFromFile(path.join(s.runDir, 'decisions.md'), [ctx.record])[ctx.record];
  if (!confirm || confirm.confirmed !== true) {
    const why = confirm && confirm.error ? `decisions.md unreadable: ${confirm.error}` : `latest logged verdict ${(confirm && confirm.latest) || 'none'}`;
    return stop(s, 'merge-supplier', 'verdict-not-confirmed', why);
  }
  emit(s, 'merge-supplier', 'ok', 'verdict auto-merge confirmed in decisions.md');
  return { ok: true };
}

// Entry, in the order the spec fixes. Each refusal is `pending-review` with no label, comment,
// ready or merge call made. The supplier check comes first and makes no call of any kind.
async function entry(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-entry';
  if (typeof deps.judgments !== 'function') return stop(s, 'merge-entry', 'no-supplier', 'no judgment supplier configured');
  let available = false;
  try {
    available = deps.ghAvailable() === true;
  } catch {
    available = false;
  }
  if (!available) return stop(s, 'merge-entry', 'gh-absent', 'gh is not available');
  const labels = readLabels(s);
  if (labels.unreadable) return stop(s, 'merge-entry', 'labels-unreadable', labels.unreadable);
  if (!labels.names.includes(AUTHORIZING_LABEL)) return stop(s, 'merge-entry', 'not-authorized', `record lacks ${AUTHORIZING_LABEL}`);
  if (ctx.summaryLogged !== true) return stop(s, 'merge-entry', 'summary-entry-missing', 'the summary decision entry was not logged');
  const notPrFirst = readIntegrationModel(s);
  if (notPrFirst) return stop(s, 'merge-entry', 'not-pr-first', notPrFirst);
  readLever(s);
  const note = s.logFailures.length ? ` (${s.logFailures.join(', ')})` : '';
  emit(s, 'merge-entry', 'ok', `entry conditions met; lever ${s.value} (${s.source})${note}`);
  s.stage = 'merge-supplier';
  return consultSupplier(s);
}

const CLOSING_LINKS_USED = ['clean', 'unlinked', 'still-linked'];
// The closed set of pre-merge actions, named verbatim in a SKIP line; anything else is free text
// and goes through reduceDetail (a literal like no-fixes-span would be mangled by neutralize).
const CLOSING_LINKS_ACTIONS = [...CLOSING_LINKS_USED, 'no-pr', 'no-fixes-span', 'gh-absent'];

// Ports pr-checklist-refresh.md "Then check the forge's closing links": unlink closing keywords
// the PR's Fixes span does not name, and learn which records must stay open (`keepOpen`, handed
// to the composer). Never a stop: any failure degrades to "not checked" with keepOpen [].
// closing-links.js self-logs gh-absent, exit 4 and exit 5; exit 3 (run dir untrusted) cannot, and
// an unexpected exit is no log at all, so those two get the driver's own SKIP line.
function closingLinks(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-closing-links';
  s.keepOpen = [];
  let r;
  try {
    r = deps.node(bin('closing-links.js'), ['--run', s.runDir, '--mode', 'pre-merge'],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    r = { code: null, stdout: '', stderr: errorText(err) };
  }
  const failuresBefore = s.logFailures.length;
  let detail;
  if (r.code === 0) {
    let env = null;
    try {
      env = JSON.parse(r.stdout);
    } catch {
      env = null;
    }
    if (env && typeof env === 'object' && CLOSING_LINKS_USED.includes(env.action) && Array.isArray(env.keepOpen)) {
      s.keepOpen = env.keepOpen.includes(ctx.record) ? [ctx.record] : [];
      detail = `closing links ${env.action}; keep open ${s.keepOpen.length ? `#${ctx.record}` : 'none'}`;
      if (env.action === 'still-linked') detail += ' (still-linked: left for post-merge Step 4.0)';
    } else {
      const action = env && typeof env === 'object' && typeof env.action === 'string' ? env.action : 'unparseable';
      detail = `closing links not checked (action ${action}); proceeding with keep open none`;
      // closing-links.js self-logs gh-absent only; every other exit-0 degraded result is ours to log.
      if (action !== 'gh-absent') {
        const what = action === 'unparseable' ? 'unparseable output' : `action ${CLOSING_LINKS_ACTIONS.includes(action) ? action : reduceDetail(action)}`;
        logDecision(s, 'Closing links (pre-merge) (degraded)',
          `condition: closing-links.js exited 0 with ${what} → fallback: closing links not checked this merge`, 'SKIP', 'n/a');
      }
    }
  } else {
    detail = `closing links not checked (exit ${r.code}); proceeding with keep open none`;
    if (r.code !== 4 && r.code !== 5) {
      logDecision(s, 'Closing links (pre-merge) (degraded)',
        `condition: closing-links.js exited ${r.code} → fallback: closing links not checked this merge`, 'SKIP', 'n/a');
    }
  }
  const note = s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
  emit(s, 'merge-closing-links', 'ok', `${detail}${note}`);
  return { ok: true };
}

// Ports pr-first-merge.md Step 3's composer fence: the Conventional-Commits subject and body the
// squash commit carries, written to files by compose-subject.js. The title is read from
// title.txt; the composer's single-quoted stdout line is never parsed. Runs before mark ready on
// purpose: a refusal leaves the PR in draft.
function compose(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-compose';
  const outDir = path.join(s.runDir, 'merge-subject');
  const keep = s.keepOpen.length ? ['--keep-open', String(ctx.record)] : [];
  let r;
  try {
    r = deps.node(bin('compose-subject.js'),
      [String(ctx.record), '--repo', ctx.repo, '--tag', 'auto-merge', ...keep, '--pr', String(ctx.pr), '--out-dir', outDir],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    return stop(s, 'merge-compose', 'unclassified', `compose: compose-subject.js failed: ${errorText(err)}`);
  }
  if (r.code === 1) return stop(s, 'merge-compose', 'compose-refused', reduceDetail(firstLine(r.stderr)));
  if (r.code === 2) {
    const line = firstLine(r.stderr);
    return stop(s, 'merge-compose', 'gh-absent', line ? reduceDetail(line) : 'compose-subject.js could not use gh');
  }
  if (r.code !== 0) return stop(s, 'merge-compose', 'unclassified', `compose: compose-subject.js exited ${r.code}`);
  let title = '';
  try {
    title = String(deps.readFile(path.join(outDir, 'title.txt'))).trim();
  } catch (err) {
    return stop(s, 'merge-compose', 'unclassified', `compose: title.txt unreadable: ${errorText(err)}`);
  }
  if (!title) return stop(s, 'merge-compose', 'unclassified', 'compose: title.txt is empty');
  s.subject = { title, bodyFile: path.join(outDir, 'body.md') };
  emit(s, 'merge-compose', 'ok', `composed subject (${title.length} chars)`);
  return { ok: true, title, bodyFile: s.subject.bodyFile };
}

// Ports pr-first-merge.md Step 2's un-draft: a draft PR is marked ready, an already-ready one is
// left alone and the skip is logged. The one place this module undrafts a PR.
function markReady(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-ready';
  let isDraft;
  try {
    const parsed = JSON.parse(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', 'isDraft']));
    isDraft = parsed && typeof parsed === 'object' ? parsed.isDraft : undefined;
  } catch (err) {
    return stop(s, 'merge-ready', 'ready-failed', `isDraft read failed: ${errorText(err)}`);
  }
  if (typeof isDraft !== 'boolean') return stop(s, 'merge-ready', 'ready-failed', 'isDraft read returned no boolean');
  const failuresBefore = s.logFailures.length;
  let detail;
  if (isDraft) {
    try {
      deps.gh(['pr', 'ready', String(ctx.pr), '--repo', ctx.repo]);
    } catch (err) {
      return stop(s, 'merge-ready', 'ready-failed', `gh pr ready failed: ${errorText(err)}`);
    }
    logDecision(s, 'Step 2 (mark ready)', `undrafted PR #${ctx.pr} (was draft).`, 'AUTO', `high (gh pr ready ${ctx.pr} --undo)`);
    detail = 'PR undrafted';
  } else {
    logDecision(s, 'Step 2 (mark ready)', `PR #${ctx.pr} already ready — skipped gh pr ready.`, 'AUTO', 'n/a (no state change)');
    detail = 'PR already ready; gh pr ready skipped';
  }
  const note = s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
  emit(s, 'merge-ready', 'ok', `${detail}${note}`);
  return { ok: true };
}

function result(s, outcome, reason, detail, extra = {}) {
  return {
    outcome, reason, detail: detail || '', mergeCommit: null, runDir: s.ctx.runDir, ciWaitMs: 0, postMerge: null,
    eventsStdoutOnly: false, ...extra,
  };
}

async function merge(ctx, deps) {
  const s = {
    ctx, deps, runDir: ctx.runDir, value: 'wait', source: 'unresolved', valueRaw: '', keepOpen: [],
    subject: null, reentries: 0, ciWaitMs: 0, lastRead: null, logFailures: [], logSeq: 0, stage: 'merge-entry',
    startedAt: typeof deps.now === 'function' ? deps.now() : 0,
  };
  try {
    const e = await entry(s);
    if (e.stop) return result(s, 'pending-review', e.stop, e.detail);
    closingLinks(s);
    const c = compose(s);
    if (c.stop) return result(s, 'pending-review', c.stop, c.detail);
    const ready = markReady(s);
    if (ready.stop) return result(s, 'pending-review', ready.stop, ready.detail);
    // Later tasks replace this tail with the gate, the watch and the merge call itself.
    return result(s, 'pending-review', 'unclassified', 'not implemented past ready');
  } catch (err) {
    return result(s, 'pending-review', 'unclassified', `${s.stage}: ${neutralize(errorText(err))}`);
  }
}

module.exports = { merge };
