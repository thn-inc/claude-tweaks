#!/usr/bin/env node
// bin/reflect-apply.js — carry the Review Console's Skill-updates reflect findings (staged
// `reflect-{n}.md` files whose **Category:** is observation or convention) to their destination (#4168).
//   node bin/reflect-apply.js --run <run-dir> [--only <name,...>] [--transport gh|emit] [--out-dir <dir>] [--repo owner/name] [--dry-run] [--help]
//   node bin/reflect-apply.js --run <run-dir> --item <name> --decline <reason>
//   node bin/reflect-apply.js --run <run-dir> --item <name> --applied edited|filed|digested [--ref <ref>]
// The destination is the finding file's own `**Destination:**` line (lib/console/reflect-destination.js,
// the parse the classifier in lib/console/resolve.js reads too); lib/console/reflect-apply.js holds the
// per-destination behaviour. A record is filed through `gh issue create` (--transport gh, the default; the
// labels are the proposal's minus auto:*/bot:*, plus type:{Type}, which needs `work-types: labels`) or
// written to <out-dir>/reflect-apply-{stem}.md for the session to file through MCP or local files
// (--transport emit; --out-dir required, --repo not accepted). A decline is recorded in the declined-learning
// store. An edit and the legacy digest line (a file with no destination line) are session work.
//
// Two-call session protocol: the first call (batch form) applies what it can itself and reports the rest
// under `session` — { item, outcome: 'edit', target } (make the edit), { item, outcome: 'record', proposal }
// (file the written proposal), { item, outcome: 'digest', line, fingerprint } (post the line to the
// materiality digest). The session does that work, then makes the second call per item — `--applied
// edited|filed|digested` (`--ref` = the issue number for filed, the posted-comment URL or id for digested;
// not accepted for edited) — which appends the AUTO line. `--decline <reason>` declines one item whatever
// its destination (the Review Console's Decline/Skip row). Every applied line is
// `AUTO … Reflect apply: staged/{name} {filed|declined|edited|digested} …` under decisions.md `## /wrap-up`;
// an item that already has one is `alreadyApplied` and nothing runs again. That is what makes a repeat safe —
// once the line has landed. A filing or decline whose append failed has NO line yet, so a re-run would file or
// record it again: it is reported in `logFailures` instead (below), and its paste-ready `line` is run first.
// A record whose Defer-reason fails the deferral gate is `refused` and logged once as a `REFUSED` Queue-write
// line (kept staged); an invalid destination is `pending`; `--only`/`--item` naming a file that is absent or
// not an applicable reflect finding is a malformed invocation.
//
// Prints one JSON object, every key always present:
//   { applied: [{ item, outcome: 'filed'|'declined'|'edited'|'digested', ref }],
//     session: [{ item, outcome: 'edit', target } | { item, outcome: 'record', proposal } | { item, outcome: 'digest', line, fingerprint }],
//     refused: [{ item, value }], pending: [{ item, reason }], alreadyApplied: [{ item, line }], failed: [{ item, error }],
//     logFailures: [{ item, error, line }] }
// `logFailures` (#4026's shape: always present, empty when none) lists each decisions.md append that failed after
// its effect landed — the issue filed, the decline recorded, the REFUSED line — with one stderr line
// (`could not append the decisions.md entry for {item}: …`). It is never a `failed` item and never changes the
// exit code; `line` is the command that logs it (`--item {name} --applied filed --ref {n}` for a filing,
// `--item {name} --decline {reason}` for a decline, a plain `--only {name}` re-run for a refusal) — run it before
// re-running the batch, since until it lands the filing has no line and a re-run files it again.
// `--dry-run` (batch form only) calls nothing and writes nothing — no gh, no recordDecline, no file, no log
// line — and adds `planned: [{ item, outcome }]` naming, per selected item, the outcome the real run reaches
// (filed|declined|edit|record|digest|refused|pending|alreadyApplied|failed); `applied` and `session` stay empty.
//
// Exit codes: 0 ok (session work and `logFailures` included); 1 any `failed` entry (a gh/recordDecline/write
// failure, a missing edit target, a gh transport without `work-types: labels`, an `--applied` whose own append
// failed — the other items still ran, and re-running the failed items is safe: nothing was done for them, except
// a gh reply with no issue number, whose error says the issue may exist — check before re-running); 2 malformed invocation
// (a missing/unknown flag, a combination that does not fit, an item that is not an applicable reflect file —
// the message lists the applicable names, an --applied that does not fit the file's destination); 3 the run dir
// is missing or not anchored under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md's
// Anchoring section, [IL-127]). This is the Sanctioned-writer vocabulary plus a 1 for per-item failures, which
// a caller branches on to retry the failed items. The proposal body file given to gh and the emitted proposal
// files are create-or-overwrite with no lock; the body file lives in a fresh os.tmpdir() directory that is
// removed once gh returns. A decisions.md that exists but cannot be read fails the item (only a missing one
// reads as empty): it is the guard against filing or declining an item twice.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTarget } = require('./lib/stage-item/write');
const { appendEntry } = require('./lib/log-decision/append');
const { recordDecline } = require('./lib/declined-learning/store');
const { readWorkTypes } = require('./lib/work-backend');
const { defaultRunner, errorText } = require('./lib/feedback/file-feedback');
const { lstatType, resolveWithin } = require('./lib/path-guard');
const {
  applyReflectItems, listApplicable, markApplied, declineItem, emptyResult, APPLIED_KINDS,
} = require('./lib/console/reflect-apply');

const USAGE = 'usage: reflect-apply.js --run <run-dir> [--only <name,...>] [--transport gh|emit] [--out-dir <dir>] [--repo owner/name] [--dry-run] [--help]\n'
  + '       reflect-apply.js --run <run-dir> --item <name> --decline <reason>\n'
  + '       reflect-apply.js --run <run-dir> --item <name> --applied edited|filed|digested [--ref <ref>]\n'
  + '  --transport gh (default) files a record with gh issue create; emit writes <out-dir>/reflect-apply-{stem}.md (--out-dir required)\n'
  + '  --ref: the issue number (filed, required), the posted-comment URL or id (digested, required); not accepted for edited\n'
  + '  exit 0 ok; 1 any failed item; 2 malformed invocation; 3 run dir missing or not anchored under the main checkout\n';

const VALUE_FLAGS = {
  '--run': 'run', '--only': 'only', '--transport': 'transport', '--out-dir': 'outDir', '--repo': 'repo',
  '--item': 'item', '--decline': 'decline', '--applied': 'applied', '--ref': 'ref',
};

function parseArgs(argv) {
  const o = {
    run: null, only: null, transport: null, outDir: null, repo: null, item: null, decline: null, applied: null, ref: null, dryRun: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--dry-run') { o.dryRun = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    // --decline and --ref land in a decisions.md entry line; a line break would split it (log-decision.js refuses the same).
    if ((a === '--decline' || a === '--ref') && /[\r\n]/.test(v)) return { error: `${a} must be one line (no line breaks)` };
    o[VALUE_FLAGS[a]] = v;
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  writeFile: (p, s) => fs.writeFileSync(p, s),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  // An edit target must resolve (leaf symlink followed, `..` normalized) to a regular file inside the checkout
  // the session edits in — a symlink out of it, a dangling one, or a directory never reads as editable.
  exists: (p, root) => {
    const real = resolveWithin(p, root);
    return real !== null && lstatType(real).type === 'file';
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: () => Date.now(),
  appendDecision: appendEntry,
  gh: defaultRunner,
  recordDecline: (fp, opts) => recordDecline(fp, opts),
  workTypes: () => readWorkTypes(process.cwd()),
  tmpFile: (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-apply-')), name),
  // Removes the directory tmpFile made for that body file.
  cleanupTmp: (p) => fs.rmSync(path.dirname(p), { recursive: true, force: true }),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`reflect-apply.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');

  const itemMode = o.item !== null || o.decline !== null || o.applied !== null;
  const transport = o.transport === null ? 'gh' : o.transport;
  let only = null;
  if (itemMode) {
    if (o.item === null) return usageError('--decline and --applied need --item <name>');
    if ((o.decline === null) === (o.applied === null)) return usageError('--item needs exactly one of --decline <reason> and --applied <kind>');
    for (const [flag, v] of [['--only', o.only], ['--transport', o.transport], ['--out-dir', o.outDir], ['--repo', o.repo]]) {
      if (v !== null) return usageError(`${flag} does not combine with --item`);
    }
    if (o.dryRun) return usageError('--dry-run does not combine with --item');
    if (o.decline !== null && o.ref !== null) return usageError('--ref only combines with --applied');
    if (o.applied !== null) {
      if (!APPLIED_KINDS.includes(o.applied)) return usageError(`--applied must be one of ${APPLIED_KINDS.join('|')}`);
      if (o.applied === 'edited' && o.ref !== null) return usageError('--ref does not combine with --applied edited');
      if (o.applied === 'filed' && !(o.ref !== null && /^#?\d+$/.test(o.ref))) return usageError('--applied filed needs --ref <issue number> (e.g. 123 or #123)');
      if (o.applied === 'digested' && o.ref === null) return usageError('--applied digested needs --ref <the posted comment url or id>');
    }
  } else {
    if (o.ref !== null) return usageError('--ref needs --item and --applied');
    if (o.only !== null) {
      only = o.only.split(',').map((s) => s.trim()).filter(Boolean);
      if (!only.length) return usageError('--only names no item');
    }
    if (transport !== 'gh' && transport !== 'emit') return usageError(`--transport must be gh or emit (got ${transport})`);
    if (transport === 'emit' && o.outDir === null) return usageError('--transport emit needs --out-dir <dir>');
    if (transport === 'gh' && o.outDir !== null) return usageError('--out-dir needs --transport emit');
    if (transport === 'emit' && o.repo !== null) return usageError('--repo needs --transport gh');
    if (o.repo !== null && !/^[^\s/]+\/[^\s/]+$/.test(o.repo)) return usageError(`--repo must be owner/name (got ${o.repo})`);
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`reflect-apply.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`reflect-apply.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`reflect-apply.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const runDir = target.dir;

  const applicable = listApplicable({ runDir, deps }).map((e) => e.name);
  const named = itemMode ? [o.item] : (only || []);
  const unknown = named.filter((n) => !applicable.includes(n));
  if (unknown.length) {
    const valid = applicable.length ? `applicable names: ${applicable.join(', ')}` : 'this run has no applicable reflect finding';
    return usageError(`not an applicable reflect finding: ${unknown.join(', ')} (${valid})`);
  }

  let result;
  if (itemMode) {
    result = emptyResult();
    let r;
    try {
      r = o.decline !== null
        ? declineItem({ runDir, item: o.item, reason: o.decline, deps })
        : markApplied({ runDir, item: o.item, kind: o.applied, ref: o.ref, deps });
    } catch (err) {
      r = { failed: { item: o.item, error: errorText(err) } };
    }
    if (r.error) return usageError(r.error);
    if (r.applied) result.applied.push(r.applied);
    if (r.alreadyApplied) result.alreadyApplied.push(r.alreadyApplied);
    if (r.failed) result.failed.push(r.failed);
    if (r.logFailure) result.logFailures.push(r.logFailure);
  } else {
    result = applyReflectItems({
      runDir,
      only,
      transport,
      outDir: o.outDir === null ? undefined : path.resolve(deps.cwd(), o.outDir),
      repo: o.repo === null ? undefined : o.repo,
      dryRun: o.dryRun,
      deps,
    });
  }
  for (const f of result.failed) deps.stderr(`reflect-apply.js: ${f.item}: ${f.error}\n`);
  for (const l of result.logFailures) deps.stderr(`reflect-apply.js: could not append the decisions.md entry for ${l.item}: ${l.error} — hand-log it with:\n${l.line}\n`);
  deps.stdout(JSON.stringify(result) + '\n');
  return result.failed.length ? 1 : 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
