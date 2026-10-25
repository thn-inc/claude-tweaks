#!/usr/bin/env node
// bin/stage-item.js — write one staged proposal file into a run's staged/
// directory.
//   node bin/stage-item.js --run <run-dir> --id <kind>-<n> --file <path> [--json <path>] [--allocate]
//     [--ledger <path> --item <text> --label <noun> [--phase <phase>] [--section <heading>]] [--help]
//     (--ledger requires --allocate)
// Exit 0 on success (writes staged/<id><ext> — and, when --json was given,
// staged/<id>.json alongside it — echoes the written path(s) to stdout, one
// per line); 2 on a malformed invocation (missing/unsafe args, unreadable
// --file/--json, --json content that isn't a JSON array, a rejected --ledger,
// --allocate with an --id that isn't a "{kind}-{n}" shape, or an --id that is
// unmapped — see #3946 below); 3 when the run dir is missing or
// not anchored under the main checkout (a worktree-local shadow —
// _shared/pipeline-run-dir.md's Anchoring section, [IL-127]), or a staged
// file is unwritable. The printed path is the run dir's realpath, which can
// differ from the caller's --run input string (e.g. a /tmp path resolves to
// /private/tmp on macOS) — a caller string-matching stdout against its own
// $RUN_DIR should account for this.
// #2770: by default --id is a plain overwrite-in-place address, exactly as
// before — every existing caller keeps its contract unchanged (e.g.
// materialize.js's `premise-satisfied-{issueNumber}`, where the trailing
// digits are a stable identity key, not a counter, and re-staging the same
// issue is an intentional update, not a collision). Pass --allocate when
// --id ("{kind}-{n}") is instead a REQUESTED slot from a per-invocation
// counter prone to racing a sibling writer (the incident this fixes:
// `/build`'s architecture-alignment check staged `build-deviation-{N}.md`
// from an N that restarted at 1 per invocation, so a later invocation in the
// same run clobbered an earlier one's findings). Under --allocate, a
// collision against an existing staged/{id} reallocates against this run
// dir's own contents instead of clobbering, and an extra stdout line
// (`--id {requested} already exists in staged/ — wrote {actual} instead`)
// reports the adjustment — the caller does not need to parse it (the first
// stdout line is still the written path), but should not assume the id it
// passed is the id that landed. See bin/lib/stage-item/write.js's
// writeStagedItem for the full contract.
// #3946 (was a #3370 warning): an --id that matches no Review Console SECTION_MAP
// prefix (console/resolve.js) and no STAGING_EXEMPTIONS entry (#3488: producers
// whose runs never reach that console) is refused — exit 2, stderr
// `stage-item.js: refused (unmapped-prefix): …` naming the nearest canonical
// prefixes — before anything is read, staged, appended to a ledger or logged.
// The check classifies the id plus the --file extension, never the file's content,
// and runs after every usage check, so it covers the plain and --ledger paths alike.
// A mapped or exempt id prints nothing.
// The staged/ half of #637 ("no CLI writes decisions.md or staged/ items");
// bin/log-decision.js is the decisions.md half, shipped under #686.
// `--ledger <path>` (#3510) turns one call into the whole carry-forward: read the
// open-items ledger and number the next row, stage --file with its `Ledger:`
// header line set to `{path}#{n}`, append row {n} (Phase `--phase`, default
// `build`; Item `--item`, suffixed `(staged/{file})` with the path actually
// written; Status `open`), and log a STAGED line under `--section` (default
// `/build`) in decisions.md. --item and --label (the noun in the log lines) are
// required, and --json is refused alongside it (exit 2). --allocate is required
// too (exit 2 without it): its exclusive create is what guarantees the cleanup
// on a failed ledger write removes only the file this call created, never an
// earlier staged file overwritten under the same id. The ledger must be a
// `ledger.md` / `*-ledger.md` under the run dir or the checkout, else exit 2.
// Every degraded path logs a SKIP line, prints `stage-item.js: ledger
// carry-forward degraded — …` on stderr, and exits 3 (the one exit-3 case a
// caller must NOT retry — a refused run dir exits 3 too, with no such prefix and
// nothing logged): an unreadable ledger, a ledger with no table, or a ledger
// that cannot take a new row safely (duplicate row numbers, or numbered rows
// outside the table) stage and append nothing; a staged write that fails leaves
// the row appended `open` with no `(staged/…)` suffix; both failing leaves
// nothing; a ledger write that fails removes the staged file (the SKIP says
// whether the removal succeeded). A row number another writer took since the
// first read is not a degraded path: the staged file's header is renumbered to
// the next free row and the call exits 0 — only if that rewrite fails is the
// staged file removed and the call degraded. A failing decisions.md write is
// only a stderr warning.
// The sequence runs under `{run-dir}/.ledger.lock` (bin/lib/stage-item/ledger.js).
// `--json` (#2612) is the machine-readable sidecar render-tidy-report.js
// reads back — an array of `{tag, record, title, action, command}` objects,
// one per Approve-section row this staged item represents. Written in the
// same call as the item's own `.md`/`.patch` file so the two can never drift
// apart the way independently-composed prose and staged/ once did.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar, parseNumberedKind, findGitRoot,
} = require('./lib/stage-item/write');
const { carryForward } = require('./lib/stage-item/ledger');
const { resolveLedgerPath } = require('./lib/wrap-up/ledger-write');
const { classifyStagedItem, nearestCanonicalPrefixes, stagingExemption } = require('./lib/console/resolve');

const USAGE = 'usage: stage-item.js --run <run-dir> --id <kind>-<n> --file <path> [--json <path>] [--allocate] [--ledger <path> --item <text> --label <noun> [--phase <phase>] [--section <heading>] (requires --allocate)] [--help]\n';

function parseArgs(argv) {
  const o = {
    run: null, id: null, file: null, json: null, allocate: false, help: false,
    ledger: undefined, item: undefined, label: undefined, phase: undefined, section: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--id') o.id = next();
    else if (a === '--file') o.file = next();
    else if (a === '--json') o.json = next();
    else if (a === '--allocate') o.allocate = true;
    else if (a === '--ledger') o.ledger = next();
    else if (a === '--item') o.item = next();
    else if (a === '--label') o.label = next();
    else if (a === '--phase') o.phase = next();
    else if (a === '--section') o.section = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// #3946: an id that matches neither a SECTION_MAP row nor a STAGING_EXEMPTIONS
// entry would reach no final Review Console outcome (it parks in Pending
// review, never auto-resolved), so it is refused before anything is read,
// staged, appended or logged. Classified by id and extension alone — no file
// content. Returns the stderr message, or null when mapped or exempt.
function unmappedPrefixRefusal(id, sourceFile) {
  const name = id + path.extname(sourceFile);
  if (stagingExemption(name) !== null) return null;
  if (classifyStagedItem(name).reason !== 'unmapped-prefix') return null;
  return `stage-item.js: refused (unmapped-prefix): --id ${id} matches no Review Console SECTION_MAP prefix and no STAGING_EXEMPTIONS entry — nothing written. Nearest canonical prefixes: ${nearestCanonicalPrefixes(id).join(', ')}\n`;
}

// #3510: the --ledger branch of run(), entered once the run dir has resolved.
function runLedger(o, { id, content, target }, deps) {
  const found = findGitRoot(deps.cwd());
  const resolved = resolveLedgerPath({
    runDir: target.dir, worktree: found ? found.dir : null, explicit: path.resolve(deps.cwd(), o.ledger),
  });
  if (!resolved.ok) {
    deps.stderr(`stage-item.js: --ledger ${o.ledger} rejected (${resolved.reason}${resolved.detail ? `: ${resolved.detail}` : ''})\n`);
    return 2;
  }
  const result = carryForward({
    runDir: target.dir,
    ledgerPath: resolved.path,
    ledgerRef: o.ledger,
    id,
    sourcePath: o.file,
    content: content.toString('utf8'),
    allocate: o.allocate,
    phase: o.phase ?? 'build',
    item: o.item,
    label: o.label,
    section: o.section ?? '/build',
    now: typeof deps.now === 'function' ? deps.now() : Date.now(),
  });
  // The degraded line goes first: callers branch on stderr *starting* with
  // this prefix (build/dispatch.md), so a log-write warning must follow it.
  if (result.code !== 0) deps.stderr(`stage-item.js: ledger carry-forward degraded — ${result.reason}\n`);
  for (const w of result.warnings) deps.stderr(`stage-item.js: warning: ${w}\n`);
  if (result.code !== 0) return result.code;
  deps.stdout(result.file + '\n');
  if (result.renamed) {
    deps.stdout(`stage-item.js: --id ${result.requestedId} already exists in staged/ — wrote ${result.id} instead\n`);
  }
  deps.stdout(`stage-item.js: appended ledger row #${result.number} to ${o.ledger}\n`);
  return 0;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`stage-item.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.file) return usageError('--file <path> is required');
  const id = sanitizeId(o.id);
  if (!id) return usageError(`--id must be a plain filename stem (letters, digits, ., _, - — no path separators): ${JSON.stringify(o.id)}`);
  if (o.allocate && !parseNumberedKind(id)) return usageError(`--allocate requires a "{kind}-{n}" --id, got ${JSON.stringify(id)}`);

  const ledgerMode = o.ledger !== undefined;
  if (ledgerMode) {
    if (!o.ledger) return usageError('--ledger requires a ledger path');
    if (!o.item) return usageError('--ledger requires --item <text>');
    if (!o.label) return usageError('--ledger requires --label <noun>');
    if (o.phase === null || o.phase === '') return usageError('--phase requires a value');
    if (o.section === null || o.section === '') return usageError('--section requires a value');
    if (o.json !== null) return usageError('--ledger cannot be combined with --json');
    if (!o.allocate) return usageError('--ledger requires --allocate (its exclusive create is what makes removing the staged file on a failed ledger write safe)');
  } else {
    const stray = [['--item', o.item], ['--label', o.label], ['--phase', o.phase], ['--section', o.section]].find(([, v]) => v !== undefined);
    if (stray) return usageError(`${stray[0]} requires --ledger`);
  }

  const refusal = unmappedPrefixRefusal(id, o.file);
  if (refusal) { deps.stderr(refusal); return 2; }

  let content;
  try { content = deps.readFile(o.file); } catch (err) {
    deps.stderr(`stage-item.js: could not read --file ${o.file} (${err && err.message})\n`);
    return 2;
  }

  let jsonContent = null;
  if (o.json !== null) {
    let raw;
    try { raw = deps.readFile(o.json); } catch (err) {
      deps.stderr(`stage-item.js: could not read --json ${o.json} (${err && err.message})\n`);
      return 2;
    }
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
      deps.stderr(`stage-item.js: --json ${o.json} is not valid JSON (${err && err.message})\n`);
      return 2;
    }
    if (!Array.isArray(parsed)) {
      deps.stderr(`stage-item.js: --json ${o.json} must contain a JSON array of items\n`);
      return 2;
    }
    jsonContent = raw;
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`stage-item.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`stage-item.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`stage-item.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  if (ledgerMode) return runLedger(o, { id, content, target }, deps);

  let result;
  try {
    result = writeStagedItem({
      runDir: target.dir, id, sourcePath: o.file, content, allocate: o.allocate,
    });
  } catch (err) {
    deps.stderr(`stage-item.js: could not write staged item (${err && err.message})\n`);
    return 3;
  }
  deps.stdout(result.file + '\n');
  if (result.renamed) {
    deps.stdout(`stage-item.js: --id ${result.requestedId} already exists in staged/ — wrote ${result.id} instead\n`);
  }

  if (jsonContent !== null) {
    let sidecar;
    try { sidecar = writeStagedSidecar({ runDir: target.dir, id: result.id, content: jsonContent }); } catch (err) {
      deps.stderr(`stage-item.js: could not write staged sidecar (${err && err.message})\n`);
      return 3;
    }
    deps.stdout(sidecar.file + '\n');
  }

  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
