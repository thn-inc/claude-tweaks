#!/usr/bin/env node
// bin/bundle-proposals.js — the Review Console's proposal bundling (#6283): staged record proposals
// that land in the same class and cite overlapping Key Files are composed into one `bundle-{n}.md`
// proposal, and each member is retired out of staged/ so the console files one record, not N.
//   node bin/bundle-proposals.js --run <run-dir> (--records-json <path> | --local)
//     [--ledger <path>] [--group-size-guard <n>]
//   node bin/bundle-proposals.js --run <run-dir> --unbundle bundle-{n}.md [--ledger <path>]
// stdout, one JSON line: { bundles: [{ path, class, members, sharedPaths }], singletons: [..], skipped: [{ path, reason }] }
// (every path relative to --run). The pure planning is bin/lib/console/bundle.js's; this file owns the
// filesystem, the ledger rows and the audit log. It never calls `gh`: the open backlog is read from
// --records-json (the console's session snapshot) or, under work-backend local-files, from --local.
// Exit 0 on success (nothing to bundle included); 2 on a malformed invocation; 3 when the run dir is
// missing or not anchored under the main checkout's .claude-tweaks/pipelines ([IL-127]) or a write failed;
// 4 when the open-backlog records are unreadable, not an array, or hold no open record (nothing written,
// nothing logged).
// Retirement: a member moves to {its dir}/bundled/ — outside staged/, so an older console reading the run
// dir sees only the bundle as creatable — with `Bundled-into:` (and for a ledger member `Ledger-row:` /
// `Ledger-resolution-was:`) header lines prepended to its original bytes; --unbundle strips them again.
// Atomicity: every bundle of one invocation is staged, retired and re-pointed before the audit lines are
// written in one append; a failure anywhere undoes all of it (exit 3), so a non-zero exit bundles nothing.
// A crashed run is repaired on the next start: a staged/bundle-* no bundled/ member names is deleted, and a
// bundled/ member whose bundle is gone goes back to staged/ with its ledger Resolution.
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveTarget, writeStagedItem, findGitRoot } = require('./lib/stage-item/write');
const { settleRow } = require('./lib/stage-item/ledger');
const { resolveLedgerPath, parseLedgerTable } = require('./lib/wrap-up/ledger-write');
const { ledgerRowCells } = require('./lib/wrap-up/ledger-cells');
const { appendEntries, formatEntry } = require('./lib/log-decision/append');
const { queryRecords, DEFAULT_DIR } = require('./lib/issues/local-store');
const { backlogHubPaths } = require('./lib/issues/grouping');
const { parseManifestYaml } = require('./lib/flow/manifest');
const { parseProposal, planBundles, composeBundle } = require('./lib/console/bundle');
const { refusedStagedNames } = require('./lib/console/resolve');

const USAGE = 'usage: bundle-proposals.js --run <run-dir> (--records-json <path> | --local) [--ledger <path>] [--group-size-guard <n>]\n'
  + '       bundle-proposals.js --run <run-dir> --unbundle bundle-<n>.md [--ledger <path>]\n'
  + '  exit 0 done (nothing to bundle included); 2 malformed invocation; 3 run dir missing/not anchored, or a write failed (nothing bundled); 4 open-backlog records unreadable, not an array, or empty\n';

const GLOB_RE = /^(leftover|ledger-record|review-followup)-/;
const BUNDLE_NAME_RE = /^bundle-\d+\.md$/;
const SECTION = '/wrap-up';
const STEP = 'Proposal bundling';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  mainRoot: undefined,
  now: () => Date.now(),
  readFile: (p) => {
    if (!fs.lstatSync(p).isFile()) throw new Error(`${p} is not a regular file`);
    return fs.readFileSync(p, 'utf8');
  },
  readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  writeFile: (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); },
  unlink: (p) => fs.rmSync(p, { force: true }),
  writeStaged: writeStagedItem,
  settleRow,
  appendEntries,
  resolveLedger: resolveLedgerPath,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function parseArgs(argv) {
  const o = {
    run: null, recordsJson: null, local: false, ledger: null, guard: null, unbundle: null, help: false,
  };
  const value = (i) => (typeof argv[i] === 'string' && !argv[i].startsWith('--') ? argv[i] : null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--local') o.local = true;
    else if (['--run', '--records-json', '--ledger', '--group-size-guard', '--unbundle'].includes(a)) {
      const v = value(i + 1);
      if (v === null) return { error: `${a} requires a value` };
      i += 1;
      if (a === '--run') o.run = v;
      else if (a === '--records-json') o.recordsJson = v;
      else if (a === '--ledger') o.ledger = v;
      else if (a === '--unbundle') o.unbundle = v;
      else o.guard = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

class Fail extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Header = text up to the first blank line.
const headerOf = (text) => text.replace(/\r\n?/g, '\n').split('\n\n')[0];

// { rel, abs } per dir that can hold staged/ members: spec-* dirs (manifest.yml order when readable, else
// numeric) and then the run dir itself.
function memberDirs(runDir, deps) {
  const found = deps.readdir(runDir).map((n) => /^spec-(\d+)$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  let ordered = [];
  try {
    const manifest = parseManifestYaml(deps.readFile(path.join(runDir, 'manifest.yml')));
    const ids = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs.map((s) => Number(s && s.id)) : [];
    ordered = ids.filter((id, i) => Number.isInteger(id) && found.includes(id) && ids.indexOf(id) === i);
  } catch { ordered = []; }
  const rest = found.filter((id) => !ordered.includes(id)).sort((a, b) => a - b);
  return [...ordered, ...rest].map((id) => ({ rel: `spec-${id}`, abs: path.join(runDir, `spec-${id}`) }))
    .concat([{ rel: '', abs: runDir }]);
}

const relPath = (dir, ...parts) => (dir.rel ? `${dir.rel}/` : '') + parts.join('/');

function loadOpenRecords(o, deps) {
  let raw;
  if (o.local) {
    try {
      raw = queryRecords(path.resolve(deps.cwd(), DEFAULT_DIR))
        .map((r) => ({ number: r.id, title: r.title, body: r.body, labels: [], state: 'OPEN' }));
    } catch (err) { throw new Fail(4, `could not read local records (${err && err.message})`); }
  } else {
    let parsed;
    try { parsed = JSON.parse(deps.readFile(path.resolve(deps.cwd(), o.recordsJson))); } catch (err) {
      throw new Fail(4, `--records-json ${o.recordsJson} is unreadable (${err && err.message})`);
    }
    if (!Array.isArray(parsed)) throw new Fail(4, `--records-json ${o.recordsJson} is not a JSON array`);
    raw = parsed;
  }
  // The session snapshot is a `--state all` pull: only open records count toward hubs and the near-duplicate screen.
  const open = raw.filter((r) => r && typeof r === 'object' && (r.state === undefined || r.state === null || String(r.state).toUpperCase() === 'OPEN'));
  if (open.length === 0) throw new Fail(4, 'no open backlog records — bundling needs the open backlog to tell hub paths from real overlap');
  return open;
}

// Where a dir's ledger is: --ledger when passed, else the dir's own, else the run's.
function makeLedgerFinder(o, target, deps) {
  const found = findGitRoot(deps.cwd());
  const worktree = found ? found.dir : deps.cwd();
  const cache = new Map();
  const resolve = (runDir, explicit) => {
    try { return deps.resolveLedger({ runDir, worktree, explicit, env: deps.env }); } catch { return { ok: false }; }
  };
  const forDir = (dir) => {
    if (cache.has(dir.abs)) return cache.get(dir.abs);
    let r;
    if (o.ledger) r = resolve(target.dir, path.resolve(deps.cwd(), o.ledger));
    else {
      r = resolve(dir.abs, null);
      if (!r.ok && dir.abs !== target.dir) r = resolve(target.dir, null);
    }
    cache.set(dir.abs, r.ok ? r.path : null);
    return cache.get(dir.abs);
  };
  const forPath = (p) => {
    const r = resolve(target.dir, p);
    return r.ok ? r.path : null;
  };
  return { forDir, forPath };
}

function pathToken(dir, name) {
  const qualified = dir.rel ? `(?:${esc(dir.rel)}/)?` : '';
  return new RegExp(`(?<![\\w/.-])${qualified}staged/${esc(name)}(?![\\w-]|\\.\\w)`);
}

// The ledger row whose Resolution names the member's staged path: { ledgerPath, row, status, resolution, token } or null.
function findLedgerRow(ledgerPath, dir, name, deps) {
  if (!ledgerPath) return null;
  let table;
  try { table = parseLedgerTable(deps.readFile(ledgerPath)); } catch { return null; }
  const token = pathToken(dir, name);
  for (const [number, line] of table.rows) {
    const cells = ledgerRowCells(line);
    if (cells.length !== 5) continue;
    const resolution = cells[4];
    const status = String(cells[3] || '').toLowerCase();
    if ((status === 'deferred' || status === 'open') && token.test(resolution)) {
      return { ledgerPath, row: Number(number), status, resolution, token };
    }
  }
  return null;
}

function rowNow(ledgerPath, row, deps) {
  const line = parseLedgerTable(deps.readFile(ledgerPath)).rows.get(String(row));
  if (line === undefined) throw new Error(`ledger row #${row} not found in ${ledgerPath}`);
  const cells = ledgerRowCells(line);
  return { status: String(cells[3] || '').toLowerCase(), resolution: cells.slice(4).join('|') };
}

// The member file as bundled/ keeps it: header lines, then the original bytes.
function bundledText(bundleRef, ledger, original) {
  const head = [`Bundled-into: ${bundleRef}`];
  if (ledger) head.push(`Ledger-row: ${ledger.ledgerPath}#${ledger.row}`, `Ledger-resolution-was: ${ledger.resolution}`);
  return `${head.join('\n')}\n${original}`;
}

const BUNDLED_HEAD_RE = /^Bundled-into: (staged\/bundle-\d+\.md)\n(?:Ledger-row: ([^\n]*)#(\d+)\nLedger-resolution-was: ([^\n]*)\n)?/;

function parseBundled(text) {
  const m = BUNDLED_HEAD_RE.exec(text);
  if (!m) return null;
  return {
    bundleRef: m[1],
    ledger: m[2] === undefined ? null : { ledgerPath: m[2], row: Number(m[3]), was: m[4] },
    original: text.slice(m[0].length),
  };
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usage = (message) => { deps.stderr(`bundle-proposals.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usage(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usage('--run <run-dir> is required');
  if (o.unbundle !== null) {
    if (!BUNDLE_NAME_RE.test(o.unbundle)) return usage(`--unbundle needs a bundle file name like bundle-1.md, got ${JSON.stringify(o.unbundle)}`);
    if (o.recordsJson || o.local || o.guard !== null) return usage('--unbundle cannot be combined with --records-json, --local or --group-size-guard');
  } else {
    if (Boolean(o.recordsJson) === o.local) return usage('exactly one of --records-json <path> or --local is required');
    if (o.guard !== null && !(/^\d+$/.test(o.guard) && Number(o.guard) >= 2)) return usage(`--group-size-guard must be an integer >= 2, got ${JSON.stringify(o.guard)}`);
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`bundle-proposals.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`bundle-proposals.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`bundle-proposals.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  try {
    return o.unbundle !== null ? unbundle(o, target, deps) : bundle(o, target, deps);
  } catch (err) {
    if (err instanceof Fail) {
      deps.stderr(`bundle-proposals.js: ${err.message}\n`);
      return err.code;
    }
    deps.stderr(`bundle-proposals.js: ${err && err.message ? err.message : err}\n`);
    return 3;
  }
}

// Restores one retired member: staged/ gets the original bytes back (skipped when they are already there),
// the ledger row its original Resolution, and the bundled/ copy goes.
function restoreMember(dir, name, parsed, deps, ledger) {
  const stagedFile = path.join(dir.abs, 'staged', name);
  let current = null;
  try { current = deps.readFile(stagedFile); } catch { current = null; }
  if (current !== parsed.original) deps.writeFile(stagedFile, parsed.original);
  if (parsed.ledger) {
    const ledgerPath = ledger.forPath(parsed.ledger.ledgerPath);
    if (!ledgerPath) throw new Error(`ledger ${parsed.ledger.ledgerPath} is not a ledger this run may write`);
    const now = rowNow(ledgerPath, parsed.ledger.row, deps);
    if (now.resolution !== parsed.ledger.was) {
      deps.settleRow({
        runDir: ledger.runDir, ledgerPath, row: parsed.ledger.row, status: now.status, resolution: parsed.ledger.was, env: deps.env,
      });
    }
  }
  deps.unlink(path.join(dir.abs, 'bundled', name));
}

// Every bundled/ file across the run's dirs, parsed: [{ dir, name, parsed }].
function bundledMembers(dirs, deps) {
  const out = [];
  for (const dir of dirs) {
    for (const name of deps.readdir(path.join(dir.abs, 'bundled')).filter((n) => n.endsWith('.md')).sort()) {
      let parsed = null;
      try { parsed = parseBundled(deps.readFile(path.join(dir.abs, 'bundled', name))); } catch { parsed = null; }
      if (parsed) out.push({ dir, name, parsed });
    }
  }
  return out;
}

function auto(text, deps) {
  return formatEntry({
    status: 'AUTO', now: deps.now(), step: STEP, text, reversibility: 'high',
  });
}

function unbundle(o, target, deps) {
  const dirs = memberDirs(target.dir, deps);
  const ledger = { ...makeLedgerFinder(o, target, deps), runDir: target.dir };
  const ref = `staged/${o.unbundle}`;
  const members = bundledMembers(dirs, deps).filter((m) => m.parsed.bundleRef === ref);
  const bundleFile = path.join(target.dir, 'staged', o.unbundle);
  let bundleExists = true;
  try { deps.readFile(bundleFile); } catch { bundleExists = false; }
  if (!bundleExists && members.length === 0) throw new Fail(2, `${ref} is not a bundle of this run: no such file and no bundled/ member names it`);
  const paths = [];
  try {
    for (const m of members) {
      restoreMember(m.dir, m.name, m.parsed, deps, ledger);
      paths.push(relPath(m.dir, 'staged', m.name));
    }
    deps.unlink(bundleFile);
    deps.appendEntries({
      runDir: target.dir, items: [{ section: SECTION, entry: auto(`un-bundled ${ref} → ${paths.join(', ')}`, deps) }],
    });
  } catch (err) {
    throw new Fail(3, `un-bundle failed (${err && err.message}) — re-run --unbundle ${o.unbundle} to finish`);
  }
  deps.stdout(`${JSON.stringify({ unbundled: ref, members: paths })}\n`);
  return 0;
}

// Crash repair (see the header): returns nothing, throws Fail(3) when a repair write fails.
function recover(o, target, dirs, deps, ledger) {
  const bundled = bundledMembers(dirs, deps);
  const named = new Set(bundled.map((m) => m.parsed.bundleRef));
  const stagedDir = path.join(target.dir, 'staged');
  for (const name of deps.readdir(stagedDir).filter((n) => BUNDLE_NAME_RE.test(n))) {
    if (!named.has(`staged/${name}`)) deps.unlink(path.join(stagedDir, name));
  }
  for (const m of bundled) {
    let present = true;
    try { deps.readFile(path.join(target.dir, m.parsed.bundleRef)); } catch { present = false; }
    if (!present) restoreMember(m.dir, m.name, m.parsed, deps, ledger);
  }
}

function enumerate(dirs, ledgerFinder, deps) {
  const proposals = [];
  const skipped = [];
  const singletons = [];
  for (const dir of dirs) {
    let refused = new Set();
    try { refused = refusedStagedNames(deps.readFile(path.join(dir.abs, 'decisions.md'))); } catch { refused = new Set(); }
    for (const name of deps.readdir(path.join(dir.abs, 'staged')).filter((n) => n.endsWith('.md') && !n.startsWith('.')).sort()) {
      if (/\.shadow-dup/.test(name) || /^ledger-record-sdd-ruling-/.test(name) || /^bundle-/.test(name) || refused.has(name)) continue;
      const key = relPath(dir, 'staged', name);
      let text;
      try { text = deps.readFile(path.join(dir.abs, 'staged', name)); } catch (err) {
        if (GLOB_RE.test(name)) skipped.push({ path: key, reason: `unreadable: ${err && err.message}` });
        continue;
      }
      const head = headerOf(text);
      if (/^Bundled-into:/m.test(head)) continue;
      const hasHeader = /^Title:/m.test(head) && (/^Type:/m.test(head) || /^Labels:/m.test(head));
      if (!GLOB_RE.test(name) && !hasHeader) continue;
      const parsed = parseProposal(name, text);
      if (!parsed) { skipped.push({ path: key, reason: 'unparseable: no Title: header' }); continue; }
      const member = { ...parsed, key, dir, text };
      if (name.startsWith('ledger-record-')) {
        member.ledger = findLedgerRow(ledgerFinder.forDir(dir), dir, name, deps);
        if (!member.ledger) {
          singletons.push(key);
          skipped.push({ path: key, reason: 'singleton: ledger row not found' });
          continue;
        }
      }
      proposals.push(member);
    }
  }
  return { proposals, skipped, singletons };
}

function bundle(o, target, deps) {
  const openRecords = loadOpenRecords(o, deps);
  const dirs = memberDirs(target.dir, deps);
  const ledgerFinder = { ...makeLedgerFinder(o, target, deps), runDir: target.dir };
  try { recover(o, target, dirs, deps, ledgerFinder); } catch (err) {
    throw new Fail(3, `could not repair an interrupted bundling run (${err && err.message})`);
  }

  const input = enumerate(dirs, ledgerFinder, deps);
  const envelope = { bundles: [], singletons: [...input.singletons], skipped: [...input.skipped] };
  if (input.proposals.length === 0) {
    envelope.singletons.sort();
    deps.stdout(`${JSON.stringify(envelope)}\n`);
    return 0;
  }

  const plan = planBundles(input.proposals, {
    hubPaths: backlogHubPaths(openRecords),
    ...(o.guard !== null ? { groupSizeGuard: Number(o.guard) } : {}),
  });
  envelope.singletons.push(...plan.singletons.map((p) => p.key));
  envelope.skipped.push(...plan.skipped.map((s) => ({ path: s.key, reason: s.reason })));

  const undo = [];
  const lines = [];
  try {
    for (const b of plan.bundles) {
      const composed = composeBundle(b, { openRecords });
      const staged = deps.writeStaged({
        runDir: target.dir, id: 'bundle-1', sourcePath: 'bundle-1.md', content: composed.text, allocate: true,
      });
      undo.push(() => deps.unlink(staged.file));
      const bundleRef = `staged/${staged.id}.md`;
      for (const m of b.members) {
        const stagedFile = path.join(m.dir.abs, 'staged', m.name);
        const bundledFile = path.join(m.dir.abs, 'bundled', m.name);
        undo.push(() => {
          let current = null;
          try { current = deps.readFile(stagedFile); } catch { current = null; }
          if (current !== m.text) deps.writeFile(stagedFile, m.text);
          deps.unlink(bundledFile);
        });
        deps.writeFile(bundledFile, bundledText(bundleRef, m.ledger, m.text));
        deps.unlink(stagedFile);
      }
      for (const m of b.members.filter((x) => x.ledger)) {
        const { ledgerPath, row, status, resolution, token } = m.ledger;
        undo.push(() => {
          if (rowNow(ledgerPath, row, deps).resolution === resolution) return;
          deps.settleRow({
            runDir: target.dir, ledgerPath, row, status, resolution, env: deps.env,
          });
        });
        deps.settleRow({
          runDir: target.dir, ledgerPath, row, status, resolution: resolution.replace(token, bundleRef), env: deps.env,
        });
      }
      envelope.bundles.push({
        path: bundleRef, class: b.class, members: b.members.map((m) => m.key), sharedPaths: b.sharedPaths,
      });
      lines.push(`bundled ${bundleRef} (${b.class}) from ${b.members.map((m) => m.key).join(', ')}; shared: ${b.sharedPaths.join(', ')}`);
    }
    if (lines.length > 0) {
      deps.appendEntries({
        runDir: target.dir, items: lines.map((text) => ({ section: SECTION, entry: auto(text, deps) })),
      });
    }
  } catch (err) {
    const failures = [];
    for (const step of undo.reverse()) {
      try { step(); } catch (undoErr) { failures.push(undoErr && undoErr.message); }
    }
    const left = failures.length > 0 ? ` — ROLLBACK INCOMPLETE (${failures.join('; ')}): inspect bundled/ and staged/bundle-*` : ' — rolled back, nothing bundled';
    throw new Fail(3, `a write failed (${err && err.message})${left}`);
  }

  envelope.singletons.sort();
  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return 0;
}

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
