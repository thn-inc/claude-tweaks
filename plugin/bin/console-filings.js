#!/usr/bin/env node
// bin/console-filings.js — dedup the Review Console's can't-tell finding filings
// against every existing record, and write the proposals that remain (#3949).
//   node bin/console-filings.js --run <run-dir> --existing <issues.json> --out-dir <dir> [--only <item,...>] [--digest-comments <file>] [--help]
//   node bin/console-filings.js --run <run-dir> --list
//   node bin/console-filings.js --run <run-dir> --fyi
// Plans one filing per can't-tell item (a console item carrying `tiebreak`,
// bin/lib/console/resolve.js's findingItems; bin/lib/console/finding-filing.js
// composes each). The default selection is the unattended rule (#4679): an item whose
// tiebreak recommended `drop` is routed to the can't-tell digest (lib/console/finding-filing.js's
// planDigests), and every other item files as a bounded verification task (planFilings with
// `unattended: true`). --only <item,...> is the interactive Approve-all/Override selection and
// keeps today's behaviour exactly: it narrows to the named item ids, plans every one as filed in
// the human-present shape (no `unattended`), and plans no digest line. --existing is the
// `gh issue list --state all --json number,body --limit N` output (a JSON array of
// { number, body }; closed records included, so a closed record still dedups): its
// bodies' work-fingerprint markers build the fingerprint map (lib/issues/record.js).
// A planned filing whose fingerprint is in the map is reported under `deduped`; each
// remaining proposal is written to <out-dir>/console-filing-{n}.md. The Review
// Console's Queue-writes step files those proposals. Never calls gh.
// A digest line whose `consolefinding-*` fingerprint a trusted comment in --digest-comments already
// holds (a JSON array of { body, authorAssociation | author_association, url? }, or a JSON string — a
// local-files specs/digest.md body) is reported under `digestDeduped`; the rest are written one per
// line to <out-dir>/console-digest.md (`digestFile`, null when there are none). The skill posts them.
// Prints JSON: { file: [{ item, fingerprint, title, proposal: <path>, claimMissing? }],
//                deduped: [{ item, fingerprint, number }], logFailures: [{ item, error }],
//                digest: [{ item, fingerprint }], digestDeduped: [{ item, fingerprint }],
//                digestFile: <path> | null }
// Each deduped entry's trace is appended to the run's decisions.md under `## /wrap-up`
// (#4026): `AUTO {time} — Queue write: {item} already filed as #{number}
// (work-fingerprint {fingerprint}). Reversibility: n/a.`, the line review-console.md's
// Can't-tell filings told the caller to log. A failed append lands in logFailures (always
// present, empty when none) with one stderr line; it never changes the exit code. Each
// digestDeduped entry is logged the same way: `AUTO {time} — Queue write: {item} already
// digested (work-fingerprint {fingerprint}). Reversibility: n/a.` --list and every non-zero exit
// log nothing.
// claimMissing (true, else absent) marks a proposal whose finding has no entry in the run's
// review-findings.json: it names the location but not the claim, and stderr says so per item.
// --list is read-only (no --existing, --out-dir, --only or --digest-comments; nothing written): it
// prints every Low-confidence/Contested row findingItems builds — the rows the
// human-present console renders — as JSON [{ id, section, recommendation,
// severity, lens, path, line, resolution, cantTell }]: resolution is the
// Approve-all default, cantTell marks the ids --only accepts.
// --fyi is read-only too (same refusals as --list, and not combinable with it): it prints
// the Low-confidence / Contested / Dropped-by-tiebreak sections the auto-merge short-circuit's
// FYI shows (lib/console/finding-outcomes.js's renderFindingFyi — each can't-tell finding with the
// record it is filed as), then a newline; nothing when the run holds no finding (#4171).
// Exit 0 on success; 2 on a malformed invocation (a missing/unknown flag, an
// unreadable or unparseable --existing, an unreadable --digest-comments or one that is neither a
// JSON array nor a JSON string, an --only naming no can't-tell item —
// the message lists the valid ids); 3
// when the run dir is missing or not anchored under the main checkout's .claude-tweaks/pipelines (a
// worktree-local shadow, or a directory outside pipelines/ — _shared/pipeline-run-dir.md's Anchoring section,
// [IL-127]), or --out-dir is unwritable. This is the Sanctioned-writer vocabulary
// (no exit 1), though the run dir's only write is those appended decisions.md
// lines: the other writes are the caller-named
// --out-dir's files, create-or-overwrite with no lock, so a caller reusing a
// directory owns what an earlier run left in it.
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveTarget } = require('./lib/stage-item/write');
const { formatEntry, appendEntry } = require('./lib/log-decision/append');
const { findingItems, runIdOf } = require('./lib/console/resolve');
const {
  planFilings, planDigestsBesideFilings, isDropRecommended, heldConsoleFindings, fingerprintMap,
} = require('./lib/console/finding-filing');
const { checkFingerprint } = require('./lib/issues/record');
const { cantTellOutcomes, renderFindingFyi } = require('./lib/console/finding-outcomes');

const USAGE = 'usage: console-filings.js --run <run-dir> --existing <issues.json> --out-dir <dir> [--only <item,...>] [--digest-comments <file>] [--help]\n'
  + '       console-filings.js --run <run-dir> --list\n'
  + '       console-filings.js --run <run-dir> --fyi\n'
  + '  exit 0 ok; 2 malformed invocation or unparseable --existing or --digest-comments; 3 run dir missing/not anchored, or --out-dir unwritable\n';

const VALUE_FLAGS = { '--run': 'run', '--existing': 'existing', '--out-dir': 'outDir', '--only': 'only', '--digest-comments': 'digestComments' };

function parseArgs(argv) {
  const o = {
    run: null, existing: null, outDir: null, only: null, digestComments: null, list: false, fyi: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--list') { o.list = true; continue; }
    if (a === '--fyi') { o.fyi = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
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
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: () => Date.now(),
  appendDecision: appendEntry,
};

// One --list row: the item's console fields plus its tiebreak verdict's, null when it has none.
function listRow(i) {
  const t = i.tiebreak || {};
  return {
    id: i.id, section: i.section, recommendation: t.recommendation ?? null, severity: t.severity ?? null,
    lens: t.lens ?? null, path: t.path ?? null, line: t.line ?? null, resolution: i.resolution, cantTell: Boolean(i.tiebreak),
  };
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`console-filings.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (o.list && o.fyi) return usageError('--list and --fyi are mutually exclusive');
  const readOnly = o.list || o.fyi;
  if (readOnly && (o.existing || o.outDir || o.only !== null || o.digestComments)) return usageError(`${o.list ? '--list' : '--fyi'} takes no --existing, --out-dir, --only or --digest-comments`);
  if (!readOnly && !o.existing) return usageError('--existing <issues.json> is required');
  if (!readOnly && !o.outDir) return usageError('--out-dir <dir> is required');
  let only = null;
  if (o.only !== null) {
    only = o.only.split(',').map((s) => s.trim()).filter(Boolean);
    if (!only.length) return usageError('--only names no item');
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`console-filings.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`console-filings.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`console-filings.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  if (o.fyi) {
    const text = renderFindingFyi(cantTellOutcomes({ runDir: target.dir, deps }));
    if (text) deps.stdout(text + '\n');
    return 0;
  }

  const { items: findingRows, findings } = findingItems({ runDir: target.dir, deps });
  if (o.list) { deps.stdout(JSON.stringify(findingRows.map(listRow)) + '\n'); return 0; }

  let rows;
  try { rows = JSON.parse(deps.readFile(path.resolve(deps.cwd(), o.existing))); } catch (err) {
    return usageError(`--existing ${o.existing} is unreadable or not JSON (${err && err.message})`);
  }
  if (!Array.isArray(rows)) return usageError(`--existing ${o.existing} must be a JSON array of { number, body }`);

  if (o.digestComments && only) return usageError('--digest-comments cannot be combined with --only (the interactive selection plans no digest)');
  let digestComments = [];
  if (o.digestComments) {
    try { digestComments = JSON.parse(deps.readFile(path.resolve(deps.cwd(), o.digestComments))); } catch (err) {
      return usageError(`--digest-comments ${o.digestComments} is unreadable or not JSON (${err && err.message})`);
    }
    if (!Array.isArray(digestComments) && typeof digestComments !== 'string') return usageError(`--digest-comments ${o.digestComments} must be a JSON array of comment objects or a JSON string`);
  }

  let items = findingRows.filter((i) => i.tiebreak);
  if (only) {
    const unknown = only.filter((id) => !items.some((i) => i.id === id));
    if (unknown.length) {
      const valid = items.length ? `valid ids: ${items.map((i) => i.id).join(', ')}` : 'this run has no can\'t-tell item';
      return usageError(`--only names no can't-tell item: ${unknown.join(', ')} (${valid})`);
    }
    items = items.filter((i) => only.includes(i.id));
  }

  // findingItems carries the Approve-all defaults; this CLI's selection is the tiebreak itself. --only is the
  // human-present selection: every named item plans as filed in today's shape, and nothing digests. The default
  // is the unattended rule: a `drop` recommendation digests, every other item files as a verification task.
  const runId = runIdOf(target.dir);
  const routed = only
    ? items.map((i) => ({ ...i, resolution: 'filed' }))
    : items.map((i) => ({ ...i, resolution: isDropRecommended(i.tiebreak) ? 'digested' : 'filed' }));
  const planned = planFilings({
    items: routed, findings, runId, ...(only ? {} : { unattended: true }),
  });
  // A finding filed and digested in one batch (two items sharing a fingerprint, `file` and `drop`): the record wins.
  const digestPlanned = only ? [] : planDigestsBesideFilings({ items: routed, findings, runId, filings: planned }).digests;

  const known = fingerprintMap(rows);
  const result = {
    file: [], deduped: [], logFailures: [], digest: [], digestDeduped: [], digestFile: null,
  };
  const toWrite = [];
  for (const p of planned) {
    if (p.claimMissing) deps.stderr(`console-filings.js: ${p.item}: the finding's claim text is unavailable (review-findings.json has no entry for its tiebreak id) — its proposal names the location only\n`);
    const number = checkFingerprint(known, p.fingerprint);
    if (number !== null) result.deduped.push({ item: p.item, fingerprint: p.fingerprint, number });
    else toWrite.push(p);
  }

  const held = heldConsoleFindings(digestComments);
  const digestLines = [];
  for (const d of digestPlanned) {
    if (d.claimMissing) deps.stderr(`console-filings.js: ${d.item}: the finding's claim text is unavailable (review-findings.json has no entry for its tiebreak id) — its digest line names the location only\n`);
    const number = checkFingerprint(known, d.fingerprint);
    if (number !== null) result.deduped.push({ item: d.item, fingerprint: d.fingerprint, number });
    else if (held.has(d.fingerprint)) result.digestDeduped.push({ item: d.item, fingerprint: d.fingerprint });
    else { result.digest.push({ item: d.item, fingerprint: d.fingerprint }); digestLines.push(d.line); }
  }

  if (!o.digestComments && digestLines.length) deps.stderr('console-filings.js: warning: --digest-comments not given — digest dedup ran against an empty digest, so an entry the open digest issue already holds is planned again (pass the issue comments, or [] when none is open)\n');

  const outDir = path.resolve(deps.cwd(), o.outDir);
  try {
    if (toWrite.length || digestLines.length) deps.mkdir(outDir);
    toWrite.forEach((p, i) => {
      const file = path.join(outDir, `console-filing-${i + 1}.md`);
      deps.writeFile(file, p.proposal);
      result.file.push({ item: p.item, fingerprint: p.fingerprint, title: p.title, proposal: file, ...(p.claimMissing ? { claimMissing: true } : {}) });
    });
    if (digestLines.length) {
      result.digestFile = path.join(outDir, 'console-digest.md');
      deps.writeFile(result.digestFile, `${digestLines.join('\n')}\n`);
    }
  } catch (err) {
    deps.stderr(`console-filings.js: could not write --out-dir ${o.outDir} (${err && err.message})\n`);
    return 3;
  }
  const now = deps.now();
  const logged = [
    ...result.deduped.map((d) => ({ item: d.item, text: `${d.item} already filed as #${d.number} (work-fingerprint ${d.fingerprint})` })),
    ...result.digestDeduped.map((d) => ({ item: d.item, text: `${d.item} already digested (work-fingerprint ${d.fingerprint})` })),
  ];
  for (const { item, text } of logged) {
    try {
      deps.appendDecision({ runDir: target.dir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now, step: 'Queue write', text, reversibility: 'n/a' }) });
    } catch (err) {
      const error = String((err && err.message) || err);
      result.logFailures.push({ item, error });
      deps.stderr(`console-filings.js: could not append the decisions.md entry for ${item}: ${error}\n`);
    }
  }
  deps.stdout(JSON.stringify(result) + '\n');
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
