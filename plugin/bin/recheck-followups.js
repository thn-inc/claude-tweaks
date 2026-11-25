#!/usr/bin/env node
// bin/recheck-followups.js — the wrap-up follow-up re-check (#6284). Open follow-up records whose
// `### Key Files` intersect the run's diff are judged per deliverable by an agent; a close/narrow
// proposal is staged as staged/followup-recheck-{n}.md for a human to approve at the Review Console.
//   node bin/recheck-followups.js candidates --run <run-dir> (--records-json <path> | --local)
//     --base <ref> [--own 1,2]
//   node bin/recheck-followups.js stage --run <run-dir> --verdicts <path>
// `candidates` runs `git diff -M <base>...HEAD` (name-status and unified), selects the records to judge and
// writes <run-dir>/recheck/candidates.json = { base, candidates: [{ number, title, items, intersecting,
// hunks, hunksOverCap, bodyHash, updatedAt }] }. stdout, one JSON line: { candidates: [numbers], overCap,
// excluded: [{ number, reason }] }.
// `stage` reads the judge's verdicts file { "<number>": { status, verdicts: [{ deliverable, verdict, quote }] } },
// validates every `satisfied` quote against the gathered hunks, and stages a proposal per candidate that has
// a satisfied deliverable. stdout, one JSON line: { staged: [ids], nothing: [numbers], judgeFailed: [numbers] }.
// `approve --run <run-dir> --id followup-recheck-<n>.md --pr <number|local>` records a human approval in
// console.json (resolution stays `pending`, plus an `approval` field); exit 5 under control mode or when the item
// is `carried`. `execute --run <run-dir> [--id <id>] [--local] [--local-merged]` runs the execution guard over
// every approved pending item and, only after the run's PR MERGED and the record is unchanged, comments (and for
// `close` closes) the record; a closed-unmerged PR drops the approval, anything else holds with one SKIP line.
// The work backend is resolved here (CLAUDE.md `work-backend:`); `--local` forces local-files.
// All verbs log to decisions.md (a SCANNED summary; one STAGED line per staged file). This CLI is a
// sanctioned run-dir writer: recheck/candidates.json is written inside the anchored dir.
// Exit 0 done (nothing to judge included; `execute` exits 0 whatever the item outcomes); 2 malformed invocation; 3 run dir missing/not anchored ([IL-127]),
// git failed, or a write failed; 4 open-backlog records unreadable, not an array, or empty; 5 `approve` refused.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveTarget, writeStagedItem, findGitRoot } = require('./lib/stage-item/write');
const { appendEntries, formatEntry } = require('./lib/log-decision/append');
const { writeFileAtomic } = require('./lib/atomic-write');
const { readWorkBackend } = require('./lib/work-backend');
const { controlModeOn, defaultExecFile } = require('./console-resolve');
const { ghOptions } = require('./lib/repo-resolve');
const { normalizeLabelNames } = require('./lib/issues/record');
const {
  queryRecords, readRecord, writeRecord, closeRecord, DEFAULT_DIR,
} = require('./lib/issues/local-store');
const { backlogHubPaths } = require('./lib/issues/grouping');
const {
  parseChangedPaths, selectCandidates, splitHunks, judgeHunks, checkVerdicts, outcomeFor, composeProposal, parseProposal, executionGuard,
} = require('./lib/console/recheck');

const USAGE = 'usage: recheck-followups.js candidates --run <run-dir> (--records-json <path> | --local) --base <ref> [--own 1,2]\n'
  + '       recheck-followups.js stage --run <run-dir> --verdicts <path>\n'
  + '       recheck-followups.js approve --run <run-dir> --id followup-recheck-<n>.md --pr <number|local>\n'
  + '       recheck-followups.js execute --run <run-dir> [--id <id>] [--local] [--local-merged]\n'
  + '  exit 0 done; 2 malformed invocation; 3 run dir missing/not anchored, git failed, or a write failed; 4 open-backlog records unreadable, not an array, or empty; 5 approve refused (control mode, or the item is carried)\n';

const SECTION = '/wrap-up';
const STEP = 'Follow-up re-check';
const CANDIDATES_REL = path.join('recheck', 'candidates.json');
const STEP_EXECUTE = 'Follow-up re-check execute';
const CONSOLE_REL = 'console.json';
const ID_RE = /^followup-recheck-\d+\.md$/;
const JUDGE_OK = new Set(['DONE', 'DONE_WITH_CONCERNS']);

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  mainRoot: undefined,
  now: () => Date.now(),
  readFile: (p) => {
    if (!fs.lstatSync(p).isFile()) throw new Error(`${p} is not a regular file`);
    return fs.readFileSync(p, 'utf8');
  },
  mtimeIso: (p) => fs.statSync(p).mtime.toISOString(),
  writeFile: (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); },
  git: (args, { cwd, env } = {}) => {
    const { GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
    return execFileSync('git', args, {
      cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
    });
  },
  writeAtomic: (p, text) => writeFileAtomic(p, text),
  // `gh` through argv only, never a shell; `input` is the body for `--body-file -`.
  gh: (args, input) => {
    const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
    return execFileSync('gh', args, ghOptions(args, {
      encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
    }));
  },
  controlMode: (runDir) => controlModeOn({ execFile: defaultExecFile, cwd: () => process.cwd(), runDir }),
  workBackend: (root) => readWorkBackend(root),
  writeStaged: writeStagedItem,
  appendEntries,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

class Fail extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const VALUE_FLAGS = {
  '--run': 'run', '--records-json': 'recordsJson', '--base': 'base', '--own': 'own', '--verdicts': 'verdicts', '--id': 'id', '--pr': 'pr',
};

function parseArgs(argv) {
  const o = {
    verb: null, run: null, recordsJson: null, local: false, localMerged: false, base: null, own: null, verdicts: null, id: null, pr: null, help: false,
  };
  const value = (i) => (typeof argv[i] === 'string' && !argv[i].startsWith('--') ? argv[i] : null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--local') o.local = true;
    else if (a === '--local-merged') o.localMerged = true;
    else if (VALUE_FLAGS[a]) {
      const v = value(i + 1);
      if (v === null) return { error: `${a} requires a value` };
      i += 1;
      o[VALUE_FLAGS[a]] = v;
    } else if (!a.startsWith('-') && o.verb === null) o.verb = a;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function loadOpenRecords(o, deps) {
  let raw;
  if (o.local) {
    try {
      const root = findGitRoot(deps.cwd());
      raw = queryRecords(path.resolve(root ? root.dir : deps.cwd(), DEFAULT_DIR))
        .map((r) => ({
          number: r.id,
          title: r.title,
          body: r.body,
          // Only `is-parent-issue` is a file-backed facet with a label; `bot:*` and `digest` are not, so a
          // local record can never carry them. The record file's mtime stands in for the forge's updatedAt.
          labels: r.facets && r.facets.isParentIssue ? ['parent-issue'] : [],
          state: 'OPEN',
          updatedAt: deps.mtimeIso(r.path),
        }));
    } catch (err) { throw new Fail(4, `could not read local records (${err && err.message})`); }
  } else {
    let parsed;
    try { parsed = JSON.parse(deps.readFile(path.resolve(deps.cwd(), o.recordsJson))); } catch (err) {
      throw new Fail(4, `--records-json ${o.recordsJson} is unreadable (${err && err.message})`);
    }
    if (!Array.isArray(parsed)) throw new Fail(4, `--records-json ${o.recordsJson} is not a JSON array`);
    raw = parsed;
  }
  const open = raw.filter((r) => r && typeof r === 'object' && (r.state === undefined || r.state === null || String(r.state).toUpperCase() === 'OPEN'));
  if (open.length === 0) throw new Fail(4, 'no open backlog records — the re-check needs the open backlog to select candidates');
  return open;
}

const logLine = (status, text, deps, reversibility) => formatEntry({
  status, now: deps.now(), step: STEP, text, reversibility,
});

// `git diff -z --name-status` -> the tab-separated lines parseChangedPaths reads: NUL-terminated tokens, a
// status then one path (two for a rename or copy, `R100`/`C75`). -z keeps a path with a tab or newline whole.
function nulNameStatusToLines(text) {
  const tokens = String(text || '').split('\0');
  const lines = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i];
    if (!/^[A-Z]/.test(status)) { i += 1; continue; }
    const n = /^[RC]/.test(status) ? 2 : 1;
    lines.push([status, ...tokens.slice(i + 1, i + 1 + n)].join('\t'));
    i += 1 + n;
  }
  return lines.join('\n');
}

const gitOpts = (deps) => ({ cwd: deps.cwd(), env: deps.env });

function candidates(o, target, deps) {
  const openRecords = loadOpenRecords(o, deps);
  const base = `${o.base}...HEAD`;
  const common = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-M'];
  let nameStatus; let unified;
  try {
    nameStatus = deps.git([...common, '-z', '--name-status', '--end-of-options', base, '--'], gitOpts(deps));
    unified = deps.git([...common, '--src-prefix=a/', '--dst-prefix=b/', '--end-of-options', base, '--'], gitOpts(deps));
  } catch (err) { throw new Fail(3, `git diff ${base} failed (${err && err.message})`); }

  const selected = selectCandidates({
    openRecords,
    changedPaths: parseChangedPaths(nulNameStatusToLines(nameStatus)),
    hubPaths: backlogHubPaths(openRecords),
    ownRecords: o.ownNumbers,
  });
  const hunksByPath = splitHunks(unified);
  const out = selected.candidates.map((c) => {
    const { hunks, overCap } = judgeHunks(hunksByPath, c.intersecting);
    return {
      number: c.number, title: c.title, items: c.items, intersecting: c.intersecting, hunks, hunksOverCap: overCap, bodyHash: c.bodyHash, updatedAt: c.updatedAt,
    };
  });

  try {
    deps.writeFile(path.join(target.dir, CANDIDATES_REL), `${JSON.stringify({ base: o.base, candidates: out }, null, 2)}\n`);
    const ids = selected.candidates.map((c) => `#${c.number}`);
    const parts = [`${ids.length} candidate(s)${ids.length ? `: ${ids.join(', ')}` : ''}`];
    if (selected.overCap.length) parts.push(`over cap: ${selected.overCap.map((n) => `#${n}`).join(', ')}`);
    if (selected.excluded.length) parts.push(`excluded: ${selected.excluded.map((e) => `#${e.number} (${e.reason})`).join(', ')}`);
    deps.appendEntries({
      runDir: target.dir, items: [{ section: SECTION, entry: logLine('SCANNED', `scanned base ${o.base}: ${parts.join('; ')}`, deps, 'n/a') }],
    });
  } catch (err) { throw new Fail(3, `a write failed (${err && err.message})`); }

  deps.stdout(`${JSON.stringify({ candidates: selected.candidates.map((c) => c.number), overCap: selected.overCap, excluded: selected.excluded })}\n`);
  return 0;
}

function stage(o, target, deps) {
  let cands; let verdictsByNumber;
  try { cands = JSON.parse(deps.readFile(path.join(target.dir, CANDIDATES_REL))); } catch (err) {
    throw new Fail(3, `${CANDIDATES_REL} is unreadable (${err && err.message}) — run the candidates verb first`);
  }
  try { verdictsByNumber = JSON.parse(deps.readFile(path.resolve(deps.cwd(), o.verdicts))); } catch (err) {
    throw new Fail(3, `--verdicts ${o.verdicts} is unreadable (${err && err.message})`);
  }
  if (!verdictsByNumber || typeof verdictsByNumber !== 'object' || Array.isArray(verdictsByNumber)) {
    throw new Fail(3, `--verdicts ${o.verdicts} is not a JSON object keyed by record number`);
  }

  const runId = path.basename(target.dir);
  const envelope = { staged: [], nothing: [], judgeFailed: [] };
  const summary = [];
  try {
    for (const c of cands.candidates || []) {
      const entry = verdictsByNumber[String(c.number)];
      if (!entry || typeof entry !== 'object' || !JUDGE_OK.has(entry.status) || !Array.isArray(entry.verdicts)
        || (entry.verdicts.length === 0 && c.items.length > 0)) {
        envelope.judgeFailed.push(c.number);
        continue;
      }
      const checked = checkVerdicts({ items: c.items, verdicts: entry.verdicts, hunks: c.hunksOverCap ? [] : c.hunks });
      const outcome = outcomeFor(checked);
      if (outcome === null) {
        envelope.nothing.push(c.number);
        continue;
      }
      const id = `followup-recheck-${c.number}`;
      deps.writeStaged({
        runDir: target.dir,
        id,
        sourcePath: `${id}.md`,
        content: composeProposal({
          number: c.number, title: c.title, outcome, checked, bodyHash: c.bodyHash, updatedAt: c.updatedAt, runId,
        }),
      });
      deps.appendEntries({
        runDir: target.dir,
        items: [{ section: SECTION, entry: logLine('STAGED', `${outcome} proposal for #${c.number} staged/${id}.md`, deps, 'high') }],
      });
      envelope.staged.push(id);
      summary.push(`staged ${outcome} #${c.number}`);
    }
    for (const n of envelope.nothing) summary.push(`nothing for #${n} (no satisfied)`);
    for (const n of envelope.judgeFailed) summary.push(`judge-failed #${n}`);
    deps.appendEntries({
      runDir: target.dir,
      items: [{ section: SECTION, entry: logLine('SCANNED', summary.length ? summary.join('; ') : 'no candidates to stage', deps, 'n/a') }],
    });
  } catch (err) { throw new Fail(3, `a write failed (${err && err.message})`); }

  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return 0;
}

// ---- approve / execute (#6284) --------------------------------------------------------------------------------

function readConsole(file, deps) {
  let text;
  try { text = deps.readFile(file); } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw new Fail(3, `${CONSOLE_REL} is unreadable (${err && err.message})`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { throw new Fail(3, `${CONSOLE_REL} is not valid JSON (${err && err.message})`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Fail(3, `${CONSOLE_REL} is not a JSON object`);
  return parsed;
}

const writeConsole = (file, data, deps) => {
  try { deps.writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`); } catch (err) { throw new Fail(3, `a write failed (${err && err.message})`); }
};

function approve(o, target, deps) {
  const file = path.join(target.dir, CONSOLE_REL);
  const existing = readConsole(file, deps);
  const items = existing && Array.isArray(existing.items) ? existing.items : [];
  const current = items.find((it) => it && it.id === o.id);
  if (current && current.resolution === 'carried') {
    throw new Fail(5, `${o.id} is carried (control mode resolves it at the acceptance packet, not here) — nothing written`);
  }
  if (deps.controlMode(target.dir)) throw new Fail(5, "control mode is on — an approval is the acceptance packet's to take, not this verb's; nothing written");
  try { deps.readFile(path.join(target.dir, 'staged', o.id)); } catch (err) {
    throw new Fail(3, `staged/${o.id} is unreadable (${err && err.message})`);
  }
  const at = new Date(deps.now()).toISOString();
  const entry = {
    id: o.id, section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-approved', approval: { at, pr: o.pr },
  };
  const next = existing
    ? { ...existing, items: current ? items.map((it) => (it && it.id === o.id ? entry : it)) : [...items, entry] }
    : { resolved: true, mode: 'recheck-approval', at, items: [entry] };
  writeConsole(file, next, deps);
  try {
    deps.appendEntries({
      runDir: target.dir,
      items: [{
        section: SECTION,
        entry: formatEntry({
          status: 'AUTO', now: deps.now(), step: STEP_EXECUTE, text: `approval recorded for ${o.id} (PR ${o.pr}); it executes only after the merge`, reversibility: 'high (remove the console.json approval)',
        }),
      }],
    });
  } catch (err) { throw new Fail(3, `a write failed (${err && err.message})`); }
  deps.stdout(`${JSON.stringify({ approved: o.id, pr: o.pr })}\n`);
  return 0;
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

// gh reads, each `{ ok: false }` on any throw or unusable output.
function ghMergeState(pr, deps) {
  try {
    const parsed = parseJson(deps.gh(['pr', 'view', '--json', 'state', '--', pr]));
    return parsed && typeof parsed.state === 'string' ? { ok: true, state: parsed.state.toUpperCase() } : { ok: false };
  } catch { return { ok: false }; }
}

function ghRecord(number, deps) {
  try {
    const parsed = parseJson(deps.gh(['issue', 'view', '--json', 'state,labels,body', '--', String(number)]));
    if (!parsed || typeof parsed.state !== 'string') return { ok: false };
    return {
      ok: true, state: parsed.state, labels: normalizeLabelNames(parsed.labels), body: typeof parsed.body === 'string' ? parsed.body : '',
    };
  } catch { return { ok: false }; }
}

function localRecordPath(number, deps) {
  const root = findGitRoot(deps.cwd());
  const found = queryRecords(path.resolve(root ? root.dir : deps.cwd(), DEFAULT_DIR)).find((r) => Number(r.id) === number);
  return found ? found.path : null;
}

function localRecord(number, deps) {
  try {
    const p = localRecordPath(number, deps);
    if (!p) return { ok: false };
    const r = readRecord(p);
    return {
      ok: true, state: r.facets && r.facets.closed ? 'CLOSED' : 'OPEN', labels: r.facets && r.facets.isParentIssue ? ['parent-issue'] : [], body: r.body || '',
    };
  } catch { return { ok: false }; }
}

function execute(o, target, deps) {
  const file = path.join(target.dir, CONSOLE_REL);
  const data = readConsole(file, deps);
  const envelope = { applied: [], dropped: [], held: [] };
  if (!data || !Array.isArray(data.items)) { deps.stdout(`${JSON.stringify(envelope)}\n`); return 0; }
  const root = findGitRoot(target.dir);
  const local = o.local || deps.workBackend(root ? root.dir : deps.cwd()) === 'local-files';
  const log = (status, text, reversibility = 'n/a') => deps.appendEntries({
    runDir: target.dir, items: [{ section: SECTION, entry: formatEntry({ status, now: deps.now(), step: STEP_EXECUTE, text, reversibility }) }],
  });
  const settle = (index, resolution) => {
    data.items[index] = { ...data.items[index], resolution };
    writeConsole(file, data, deps);
  };

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (!item || typeof item !== 'object' || !item.approval || item.resolution !== 'pending') continue;
    if (o.id !== null && item.id !== o.id) continue;
    let proposal = null;
    try { proposal = parseProposal(deps.readFile(path.join(target.dir, 'staged', String(item.id)))); } catch { proposal = null; }
    const pr = typeof item.approval.pr === 'string' ? item.approval.pr : '';
    const merge = () => (pr === 'local' ? { ok: true, state: o.localMerged ? 'MERGED' : 'OPEN' } : ghMergeState(pr, deps));
    const record = () => (local ? localRecord(proposal.number, deps) : ghRecord(proposal.number, deps));
    const verdict = executionGuard({
      proposal, approval: item.approval, merge, record,
    });
    const name = proposal ? `#${proposal.number}` : String(item.id);

    if (verdict.action === 'hold') {
      log('SKIP', `held ${item.id} (${name}): ${verdict.reason}; the approval stays pending`);
      envelope.held.push({ id: item.id, reason: verdict.reason });
      continue;
    }
    if (verdict.action === 'drop') {
      settle(i, 'dropped');
      log('AUTO', `dropped the approval for ${item.id} (${name}): ${verdict.reason}; no comment, no close`);
      envelope.dropped.push(item.id);
      continue;
    }

    const closing = proposal.action === 'close';
    let posted = false;
    try {
      if (local) {
        const p = localRecordPath(proposal.number, deps);
        const rec = readRecord(p);
        writeRecord(p, { title: rec.title, body: `${rec.body || ''}\n\n${proposal.comment}\n`, facets: rec.facets });
        posted = true;
        if (closing) closeRecord(p);
      } else {
        deps.gh(['issue', 'comment', '--body-file', '-', '--', String(proposal.number)], proposal.comment);
        posted = true;
        if (closing) deps.gh(['issue', 'close', '--reason', 'completed', '--', String(proposal.number)]);
      }
    } catch (err) {
      const why = posted ? `the comment was posted but the close failed (${err && err.message}); a re-run would comment again` : `the comment failed (${err && err.message})`;
      log('SKIP', `held ${item.id} (${name}): ${why}; the approval stays pending`);
      envelope.held.push({ id: item.id, reason: posted ? 'close-failed' : 'comment-failed' });
      continue;
    }
    settle(i, 'applied');
    log('AUTO', `${closing ? 'closed' : 'narrowed (commented on)'} ${name} from ${item.id} after the merge`, closing ? 'high (gh issue reopen)' : 'n/a');
    envelope.applied.push(item.id);
  }
  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return 0;
}

// One entry per verb: the flags it requires, then the handler. A later verb registers here.
const VERBS = {
  candidates: { handler: candidates },
  stage: { handler: stage },
  approve: { handler: approve },
  execute: { handler: execute },
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usage = (message) => { deps.stderr(`recheck-followups.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usage(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.verb) return usage('a verb is required (candidates | stage | approve | execute)');
  const verb = Object.hasOwn(VERBS, o.verb) ? VERBS[o.verb] : null;
  if (!verb) return usage(`unknown verb: ${o.verb}`);
  if (!o.run) return usage('--run <run-dir> is required');

  if (o.verb === 'candidates') {
    if (Boolean(o.recordsJson) === o.local) return usage('exactly one of --records-json <path> or --local is required');
    if (!o.base) return usage('--base <ref> is required');
    if (o.base.startsWith('-')) return usage(`--base must be a revision, got ${JSON.stringify(o.base)}`);
    o.ownNumbers = [];
    if (o.own !== null) {
      for (const part of o.own.split(',')) {
        if (!/^\d+$/.test(part.trim())) return usage(`--own takes comma-separated record numbers, got ${JSON.stringify(part)}`);
        o.ownNumbers.push(Number(part.trim()));
      }
    }
  } else if (o.verb === 'stage') {
    if (!o.verdicts) return usage('--verdicts <path> is required');
  } else if (o.verb === 'approve') {
    if (!o.id || !ID_RE.test(o.id)) return usage('--id followup-recheck-<n>.md is required');
    if (!o.pr || (o.pr !== 'local' && !/^\d+$/.test(o.pr))) return usage('--pr <number|local> is required');
  } else if (o.verb === 'execute') {
    if (o.id !== null && !ID_RE.test(o.id)) return usage('--id must be followup-recheck-<n>.md');
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`recheck-followups.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`recheck-followups.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`recheck-followups.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  try {
    return verb.handler(o, target, deps);
  } catch (err) {
    if (err instanceof Fail) {
      deps.stderr(`recheck-followups.js: ${err.message}\n`);
      return err.code;
    }
    deps.stderr(`recheck-followups.js: ${err && err.message ? err.message : err}\n`);
    return 3;
  }
}

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
