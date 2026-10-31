#!/usr/bin/env node
// bin/stash-guard.js -- protect the repo-wide git stash during a dispatched
// agent run (#4559). The stash stack is shared by every worktree of a checkout,
// so an implementer that runs `git stash drop`/`pop`/`clear` can destroy a
// sibling session's saved work. The controller snapshots the stack before the
// dispatch and compares after it; with --restore, entries the agent removed are
// put back with `git stash store`.
//
//   node bin/stash-guard.js snapshot --repo <dir> --out <file>
//   node bin/stash-guard.js compare  --repo <dir> --baseline <file> [--restore]
//                            [--run <run-dir> (--task <k> | --label <slug> | --task <k> --label <slug>)]
//
// snapshot writes [{sha, subject}] (newest first) to --out -- a create-or-overwrite
// with no lock -- and prints one line {"out","count"}; exit 0.
// compare prints one JSON line {removed, added}; --restore adds restored,
// alreadyPresent (a removed sha the pre-store re-read found back on the stack, so it
// is not stored twice) and restoreFailed [{sha, subject, error, command}] (each
// command is also printed to stderr, paste-ready); --run adds logged, plus logError
// when the append was refused or threw. logged:false with no logError means there was
// nothing to log. An added entry is reported and left on the stack, never popped.
//
// Exit codes: 0 the stack is unchanged, 3 it changed (the JSON line is the answer;
// a restore failure is data too, not a different code), 2 malformed invocation, an
// unreadable or invalid baseline, or a git or write failure. No 1.
//
// Self-logging: with --run the CLI appends its own decisions.md lines under /build
// (step "Stash guard"), only when something changed. A refused or unanchored --run,
// or a failed append, never changes the exit code and never stops a restore: the
// restores run first and the failure surfaces as logged:false, logError and one
// stderr line; the run-dir warning is hoisted ahead of the first store. --run needs
// --restore (the log records what the restore did) and --task and/or --label (who
// to name in the line); --task and --label need --run.
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const { resolveTarget, formatEntry, appendEntries, hms } = require('./lib/log-decision/append');

const NAME = 'stash-guard.js';
const SECTION = '/build';
const STEP = 'Stash guard';
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const LABEL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_RE = /^[1-9]\d*$/;

const USAGE = `usage: ${NAME} snapshot --repo <dir> --out <file>\n`
  + `       ${NAME} compare --repo <dir> --baseline <file> [--restore]\n`
  + '                       [--run <run-dir> (--task <k> | --label <slug> | --task <k> --label <slug>)]\n'
  + '  snapshot: writes [{sha, subject}] to <file>; prints {"out","count"}\n'
  + '  compare: prints {removed, added}; with --restore also restored, alreadyPresent, restoreFailed;\n'
  + '           with --run also logged (+ logError) and appends the decisions.md lines under /build\n'
  + '  exit 0 unchanged; 3 changed; 2 malformed invocation, invalid baseline or git/write failure\n';

const VALUE_FLAGS = {
  '--repo': 'repo', '--out': 'out', '--baseline': 'baseline', '--run': 'run', '--task': 'task', '--label': 'label',
};
const VERBS = ['snapshot', 'compare'];

function parseArgs(argv) {
  const o = {
    verb: null, repo: null, out: null, baseline: null, restore: false, run: null, task: null, label: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      o.help = true;
    } else if (a === '--restore') {
      o.restore = true;
    } else if (Object.hasOwn(VALUE_FLAGS, a)) {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--task') {
        if (!TASK_RE.test(v) || !Number.isSafeInteger(Number(v))) return { error: `${a} must be a positive integer: ${v}` };
        o.task = Number(v);
      } else if (a === '--label') {
        if (!LABEL_RE.test(v)) return { error: `${a} must be a lowercase hyphenated slug: ${v}` };
        o.label = v;
      } else {
        o[VALUE_FLAGS[a]] = v;
      }
    } else if (a.startsWith('-')) {
      return { error: `unknown argument: ${a}` };
    } else if (o.verb === null) {
      if (!VERBS.includes(a)) return { error: `unknown verb: ${a}` };
      o.verb = a;
    } else {
      return { error: `unexpected argument: ${a}` };
    }
  }
  if (o.help) return o;
  if (o.verb === null) return { error: 'a verb is required (snapshot | compare)' };
  const given = (k) => o[k] !== null && o[k] !== false;
  const need = (...keys) => keys.filter((k) => o[k] === null).map((k) => `--${k}`);
  const refuse = (...keys) => keys.filter(given).map((k) => `--${k}`);
  if (o.verb === 'snapshot') {
    if (need('repo', 'out').length) return { error: `snapshot needs ${need('repo', 'out').join(' and ')}` };
    if (refuse('baseline', 'restore', 'run', 'task', 'label').length) return { error: `snapshot does not take ${refuse('baseline', 'restore', 'run', 'task', 'label').join(', ')}` };
    return o;
  }
  if (need('repo', 'baseline').length) return { error: `compare needs ${need('repo', 'baseline').join(' and ')}` };
  if (given('out')) return { error: 'compare does not take --out' };
  if (o.run !== null && !o.restore) return { error: '--run needs --restore' };
  if (o.run !== null && o.task === null && o.label === null) return { error: '--run needs --task and/or --label' };
  if (o.run === null && (o.task !== null || o.label !== null)) return { error: '--task and --label need --run' };
  return o;
}

const realDeps = {
  git: (args) => childProcess.execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  writeFile: (file, text) => fs.writeFileSync(file, text),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  appendEntries,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// The stash stack, newest first. --no-show-signature keeps a user's log.showSignature=true
// from injecting gpg text into the format; %x00 splits the sha from the reflog subject,
// which can hold any character a stash message can.
function readStack(git, repo) {
  const out = git(['-C', repo, 'stash', 'list', '--no-show-signature', '--format=%H%x00%gs']);
  return String(out).split('\n').filter(Boolean).map((line) => {
    const at = line.indexOf('\0');
    if (at === -1) throw new Error(`unparseable stash list line: ${line}`);
    return { sha: line.slice(0, at), subject: line.slice(at + 1) };
  });
}

// The recovery command for an entry, quoted for a POSIX shell: the subject is
// double-quoted, so backslash, quote, dollar and backtick are escaped.
function storeCommand(subject, sha) {
  return `git stash store -m "${subject.replace(/[\\"$`]/g, '\\$&')}" ${sha}`;
}

function who(task, label) {
  if (label && task) return `${label} dispatch for task ${task}`;
  if (label) return `${label} dispatch`;
  return `implementer for task ${task}`;
}

const messageOf = (e) => String((e && e.message) || e);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

// The baseline file -> { entries } | { error }. Every element needs a sha and a subject: a
// bad one would reach `git stash store` as an argument.
function loadBaseline(deps, file) {
  let parsed;
  try {
    parsed = JSON.parse(deps.readFile(file));
  } catch (e) {
    return { error: `cannot read baseline ${file}: ${messageOf(e)}` };
  }
  const valid = Array.isArray(parsed) && parsed.every((e) => (
    e !== null && typeof e === 'object' && typeof e.sha === 'string' && SHA_RE.test(e.sha) && typeof e.subject === 'string'
  ));
  if (!valid) return { error: `baseline ${file} is not a [{sha, subject}] list` };
  return { entries: parsed.map((e) => ({ sha: e.sha, subject: e.subject })) };
}

function snapshot(o, deps) {
  const entries = readStack(deps.git, o.repo);
  try {
    deps.writeFile(o.out, `${JSON.stringify(entries)}\n`);
  } catch (e) {
    deps.stderr(`${NAME}: cannot write ${o.out}: ${messageOf(e)}\n`);
    return 2;
  }
  deps.stdout(`${JSON.stringify({ out: o.out, count: entries.length })}\n`);
  return 0;
}

// The decisions.md target for --run -> { ok: true } | { ok: false, error }. Never throws.
function checkRunDir(deps, runDir) {
  try {
    const target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot });
    if (target.ok) return { ok: true };
    return {
      ok: false,
      error: target.reason === 'missing'
        ? `run dir does not exist: ${runDir}`
        : `run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`,
    };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

// Store the removed entries back, oldest first (the list is newest first, so the
// original relative order comes back). The stack is re-read right before each store:
// a sibling guard may have restored the entry in between, and a duplicate would cost
// a `git stash drop` where a skipped restore could cost the entry, so a failed
// re-read falls through to the store. Returns each outcome keyed by sha.
function restoreRemoved(deps, repo, removed) {
  const outcome = new Map();
  for (const entry of removed.slice().reverse()) {
    let present = false;
    try {
      present = readStack(deps.git, repo).some((e) => e.sha === entry.sha);
    } catch { /* fall through to the store */ }
    if (present) { outcome.set(entry.sha, { alreadyPresent: true }); continue; }
    try {
      deps.git(['-C', repo, 'stash', 'store', '-m', entry.subject, entry.sha]);
      outcome.set(entry.sha, { restored: true });
    } catch (e) {
      const command = storeCommand(entry.subject, entry.sha);
      const error = oneLine((e && e.stderr && String(e.stderr).trim()) || messageOf(e));
      outcome.set(entry.sha, { failed: { sha: entry.sha, subject: entry.subject, error, command } });
      deps.stderr(`${NAME}: restore failed for ${entry.sha}; recover with:\n${command}\n`);
    }
  }
  return outcome;
}

const listOf = (entries) => entries.map((e) => `${e.sha} ${e.subject}`).join(', ');
const entriesWord = (entries) => (entries.length === 1 ? 'entry' : 'entries');

function logItems(deps, o, body) {
  const now = deps.now();
  const name = who(o.task, o.label);
  const auto = (text, reversibility) => ({ section: SECTION, entry: formatEntry({ status: 'AUTO', now, step: STEP, text, reversibility }) });
  const items = [];
  const removedText = (entries) => `${name} removed stash ${entriesWord(entries)} ${listOf(entries)}`;
  const byRemoval = (shas) => body.removed.filter((e) => shas.includes(e.sha));
  const restored = byRemoval(body.restored);
  const present = byRemoval(body.alreadyPresent);
  if (restored.length) items.push(auto(`${removedText(restored)}; restored via git stash store`, 'high'));
  if (present.length) items.push(auto(`${removedText(present)}; already back on the stack before restore, not stored again`, 'n/a (a detection, not a mutation)'));
  // formatEntry rejects FAILED, so these lines are composed by hand.
  for (const f of body.restoreFailed) {
    items.push({
      section: SECTION,
      entry: `- FAILED ${hms(now)} — ${STEP}: ${name} removed stash entry ${f.sha} ${f.subject}; restore failed: ${f.error} — recover with: ${f.command}. Reversibility: n/a (write did not land).`,
    });
  }
  if (body.added.length) {
    items.push(auto(`${name} added stash ${entriesWord(body.added)} ${listOf(body.added)}; left on the stack, never popped automatically`, 'n/a (a detection, not a mutation)'));
  }
  return items;
}

function compare(o, deps) {
  const baseline = loadBaseline(deps, o.baseline);
  if (baseline.error) { deps.stderr(`${NAME}: ${baseline.error}\n`); return 2; }
  const current = readStack(deps.git, o.repo);
  const removed = baseline.entries.filter((b) => !current.some((c) => c.sha === b.sha));
  const added = current.filter((c) => !baseline.entries.some((b) => b.sha === c.sha));
  const changed = removed.length > 0 || added.length > 0;
  const body = { removed, added };

  // The run-dir warning comes before the first store: it says the audit line will not land.
  const target = o.run !== null && changed ? checkRunDir(deps, o.run) : null;
  if (target && !target.ok) deps.stderr(`${NAME}: warning: the decisions.md entry will not be written — ${target.error}\n`);

  if (o.restore) {
    const outcome = restoreRemoved(deps, o.repo, removed);
    const pick = (key) => removed.filter((e) => outcome.get(e.sha)[key]);
    body.restored = pick('restored').map((e) => e.sha);
    body.alreadyPresent = pick('alreadyPresent').map((e) => e.sha);
    body.restoreFailed = pick('failed').map((e) => outcome.get(e.sha).failed);
  }

  if (o.run !== null) {
    body.logged = false;
    if (changed) {
      let logError = '';
      if (!target.ok) {
        logError = target.error;
      } else {
        try {
          deps.appendEntries({ runDir: o.run, items: logItems(deps, o, body) });
        } catch (e) {
          logError = messageOf(e);
        }
      }
      if (logError) {
        body.logError = logError;
        deps.stderr(`${NAME}: could not append the decisions.md entry: ${logError}\n`);
      } else {
        body.logged = true;
      }
    }
  }
  deps.stdout(`${JSON.stringify(body)}\n`);
  return changed ? 3 : 0;
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`${NAME}: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  try {
    return o.verb === 'snapshot' ? snapshot(o, deps) : compare(o, deps);
  } catch (e) {
    deps.stderr(`${NAME}: ${messageOf(e)}\n`);
    return 2;
  }
}

module.exports = { run, parseArgs, readStack, storeCommand, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
