#!/usr/bin/env node
// bin/release-note-repair.js — /tidy Shape 4.5 (#2828): a `ready` record whose only spec-shape gap
// is its `## Release Note` gets one composed line inserted in place, labels untouched. Consumed by
// skills/tidy/step-1-records.md (scan) and skills/tidy/release-note-repair.md (repair, verify).
//   scan   --driver github-issues|local-files --records <faceted-json> --out <candidates-json>
//   repair --driver github-issues --ref <n> --live-json <file> --expect-sha <sha256> --line-file <file> --out <body-file> (--run <run-dir> | --snapshot-file <file>)
//   repair --driver local-files --ref <id> --record-file <path> --expect-sha <sha256> --line-file <file> (--run <run-dir> | --snapshot-file <file>)
//   verify --ref <n> --before-json <file> --after-json <file> --line-file <file> [--run <run-dir>]
// Exit codes: Sanctioned-writer base (0 done / 2 malformed invocation or unreadable input / 3 run
// dir missing or not anchored under the main checkout, or a snapshot/--out/record write failed) plus
// domain codes, each branched on by release-note-repair.md: 4 the composed line fails a bound —
// recompose once; 5 stale premise — skip, nothing written; 6 repair failure — nothing written
// (local-files: original restored); 7 post-write verification failed (`verify`: the live body
// itself no longer matches what this run wrote; `repair --driver local-files`: the CLI's own
// automatic restore attempt failed to write); 8 post-write verification failed, but an automatic
// restore is refused and was never attempted — `verify`: the ONLY drift is the label set (the
// body verified clean; `gh issue edit --body-file` can't touch labels anyway, so there's nothing
// to restore); `repair --driver local-files`: the record file on disk no longer matches the exact
// text this call spliced (something else wrote to it between the write and the re-read), so
// overwriting it now would stomp that other write. The snapshot is always written before any
// output body or record file, and a repair without a snapshot destination is refused — the undo
// copy precedes the write by construction.
'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const detect = require('./lib/release-note-repair/detect');
const apply = require('./lib/release-note-repair/apply');
const { resolveTarget } = require('./lib/stage-item/write');
const { readRecord } = require('./lib/issues/local-store');
const { writeFileAtomic } = require('./lib/atomic-write');
const logDecision = require('./log-decision');

const USAGE = [
  'usage: release-note-repair.js scan --driver github-issues|local-files --records <faceted-json> --out <candidates-json>',
  '       release-note-repair.js repair --driver github-issues --ref <n> --live-json <file> --expect-sha <sha256> --line-file <file> --out <body-file> (--run <run-dir> | --snapshot-file <file>)',
  '       release-note-repair.js repair --driver local-files --ref <id> --record-file <path> --expect-sha <sha256> --line-file <file> (--run <run-dir> | --snapshot-file <file>)',
  '       release-note-repair.js verify --ref <n> --before-json <file> --after-json <file> --line-file <file> [--run <run-dir>]',
  'exit: 0 done | 2 malformed or unreadable input | 3 run dir missing/not anchored, or a write failed',
  '      4 line fails a bound | 5 stale premise, skipped | 6 repair failure, nothing written',
  '      7 post-write verification failed (`verify`: the live body itself no longer matches what this run wrote; `repair --driver local-files`: the CLI\'s own restore attempt itself failed)',
  '      8 post-write verification failed, restore refused (`verify`: labels-only drift, body verified clean; `repair --driver local-files`: the record file no longer matches what this run wrote)',
].join('\n') + '\n';

const FLAGS = {
  scan: ['driver', 'records', 'out'],
  repair: ['driver', 'ref', 'live-json', 'record-file', 'expect-sha', 'line-file', 'out', 'run', 'snapshot-file'],
  verify: ['ref', 'before-json', 'after-json', 'line-file', 'run'],
};
const DRIVERS = ['github-issues', 'local-files'];
const REF_RE = /^[1-9]\d*$/;
const SHA_RE = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h') return { help: true };
  if (!Object.prototype.hasOwnProperty.call(FLAGS, cmd)) return { error: `unknown subcommand: ${cmd}` };
  const o = { cmd };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--help' || a === '-h') return { help: true };
    const key = a.startsWith('--') ? a.slice(2) : null;
    if (!key || !FLAGS[cmd].includes(key)) return { error: `unknown argument for ${cmd}: ${a}` };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${a} needs a value` };
    o[key] = value;
    i += 1;
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  checkCli: undefined,
};

function readText(p) { return fs.readFileSync(p, 'utf8'); }

function outcomeExit(prep, deps) {
  if (prep.outcome === 'bounds') {
    deps.stderr(`release-note-repair.js: the composed line fails a bound:\n${prep.violations.map((v) => `  - ${v}`).join('\n')}\n`);
    return 4;
  }
  if (prep.outcome === 'stale') { deps.stderr(`release-note-repair.js: stale premise — ${prep.reason}\n`); return 5; }
  deps.stderr(`release-note-repair.js: repair failed — ${prep.reason}\n`);
  return 6;
}

function logAuto(deps, runDir, text) {
  const code = logDecision.run(
    ['--run', runDir, '--section', '/tidy', '--status', 'AUTO', '--step', 'Step 7 Fill Release Note', '--text', text, '--reversibility', 'high'],
    { now: deps.now, cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: () => {}, stderr: deps.stderr },
  );
  return code === 0;
}

// -> { file, runDir } | { usage } | { anchor }
function snapshotTarget(o, deps) {
  if (o.run && o['snapshot-file']) return { usage: 'pass --run or --snapshot-file, not both' };
  if (!o.run && !o['snapshot-file']) return { usage: 'a repair needs a pre-write snapshot destination: --run <run-dir> or --snapshot-file <file>' };
  if (o['snapshot-file']) return { file: o['snapshot-file'], runDir: null };
  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) { return { anchor: (err && err.message) || String(err) }; }
  if (!target.ok) {
    return { anchor: target.reason === 'missing' ? `run dir does not exist: ${o.run}` : `run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run}` };
  }
  return { file: path.join(target.dir, 'snapshots', `tidy-release-note-${o.ref}.original.md`), runDir: target.dir };
}

function writeSnapshot(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function cmdScan(o, deps, usage) {
  if (!DRIVERS.includes(o.driver)) return usage('--driver must be github-issues or local-files');
  if (!o.records || !o.out) return usage('--records and --out are required');
  let records;
  try { records = JSON.parse(readText(o.records)); } catch (err) { return usage(`could not read --records ${o.records} (${err.message})`); }
  if (!Array.isArray(records)) return usage('--records must hold a JSON array');
  const candidates = detect.scanRecords(records, { driver: o.driver, checkCli: deps.checkCli });
  const payload = { generatedAt: new Date(deps.now()).toISOString(), driver: o.driver, candidates };
  try { fs.writeFileSync(o.out, `${JSON.stringify(payload, null, 2)}\n`); } catch (err) { return usage(`could not write --out ${o.out} (${err.message})`); }
  const line = detect.summaryLine(candidates, o.out);
  if (line) deps.stdout(`${line}\n`);
  return 0;
}

function repairGithub(o, deps, usage, rawLine, dest) {
  if (!o['live-json'] || !o.out) return usage('github-issues repair needs --live-json and --out');
  // A reused --out path never carries a previous record's body past this call's own exit —
  // unlink before any work, not just on a failure branch, so an exit-5/6 leaves --out absent
  // rather than stale.
  try { fs.unlinkSync(o.out); } catch { /* absent is fine */ }
  let live;
  try { live = JSON.parse(readText(o['live-json'])); } catch (err) { return usage(`could not read --live-json (${err.message})`); }
  if (!live || typeof live.body !== 'string') return usage('--live-json carries no body string');
  if (String(live.state || '').toUpperCase() !== 'OPEN') return outcomeExit({ outcome: 'stale', reason: `the record is ${live.state || 'in an unknown state'}` }, deps);
  if (!detect.labelNames(live.labels).includes('ready')) return outcomeExit({ outcome: 'stale', reason: 'the record no longer carries ready' }, deps);
  const prep = apply.prepareRepair({ liveBody: live.body, expectSha: o['expect-sha'], line: rawLine, checkCli: deps.checkCli });
  if (prep.outcome !== 'ready') return outcomeExit(prep, deps);
  try { writeSnapshot(dest.file, live.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write snapshot ${dest.file} (${err.message})\n`); return 3; }
  try { fs.writeFileSync(o.out, prep.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write --out ${o.out} (${err.message})\n`); return 3; }
  deps.stdout(`${JSON.stringify({ ref: `#${o.ref}`, mode: prep.mode, line: prep.line, snapshot: dest.file, out: o.out })}\n`);
  return 0;
}

function repairLocal(o, deps, usage, rawLine, dest) {
  if (!o['record-file']) return usage('local-files repair needs --record-file');
  const file = o['record-file'];
  let raw;
  let live;
  try { raw = readText(file); live = readRecord(file); } catch (err) {
    return outcomeExit({ outcome: 'stale', reason: `could not read ${file} (${err.message})` }, deps);
  }
  if (live.facets.closed) return outcomeExit({ outcome: 'stale', reason: 'the record is closed' }, deps);
  if (live.facets.stage !== 'ready') return outcomeExit({ outcome: 'stale', reason: 'the record is no longer ready' }, deps);
  const prep = apply.prepareRepair({ liveBody: live.body, expectSha: o['expect-sha'], line: rawLine, checkCli: deps.checkCli });
  if (prep.outcome !== 'ready') return outcomeExit(prep, deps);
  // Splice the raw file, not writeRecord: re-serializing frontmatter can rewrite bytes outside the section.
  let applied;
  try { applied = apply.applyReleaseNote(raw, prep.line); } catch (err) {
    if (err instanceof apply.RepairError) return outcomeExit({ outcome: 'failed', reason: err.message }, deps);
    throw err;
  }
  if (!apply.onlyReleaseNoteAdded(raw, applied.body, prep.line)) {
    return outcomeExit({ outcome: 'failed', reason: 'the record-file line diff shows more than the Release Note section' }, deps);
  }
  try { writeSnapshot(dest.file, raw); } catch (err) { deps.stderr(`release-note-repair.js: could not write snapshot ${dest.file} (${err.message})\n`); return 3; }
  try { writeFileAtomic(file, applied.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write ${file} (${err.message}) — unchanged\n`); return 3; }
  let after = null;
  try { after = readRecord(file); } catch { after = null; }
  const verified = after !== null
    && isDeepStrictEqual(after.facets, live.facets)
    && after.title === live.title
    && detect.checkBody(after.body, { checkCli: deps.checkCli }).verdict === 'conforming';
  if (!verified) {
    // Restore only when the file on disk still holds exactly the bytes this call spliced —
    // proof nothing else has touched it since the write, so overwriting it with `raw` is safe.
    // If it no longer matches (another write landed between our write and this re-read), the
    // restore is refused rather than attempted: stomping that other write would be worse than
    // leaving the current, unverified content in place for a human to look at.
    let currentRaw = null;
    try { currentRaw = fs.readFileSync(file, 'utf8'); } catch { currentRaw = null; }
    if (currentRaw !== applied.body) {
      const drift = currentRaw === null
        ? 'the file could not be re-read'
        : `${currentRaw.length} bytes on disk now vs ${applied.body.length} this run wrote`;
      deps.stderr(`release-note-repair.js: the record file no longer matches what this run wrote (${drift}) — restore refused (original preserved at ${dest.file})\n`);
      return 8;
    }
    try { writeFileAtomic(file, raw); } catch (err) {
      deps.stderr(`release-note-repair.js: re-read verification failed and restoring ${file} failed (${err.message}); original at ${dest.file}\n`);
      return 7;
    }
    return outcomeExit({ outcome: 'failed', reason: 'the written record failed re-read verification; the original was restored' }, deps);
  }
  const logged = dest.runDir
    ? logAuto(deps, dest.runDir, `filled the Release Note on ${file} with "${prep.line}"; snapshot ${path.relative(dest.runDir, dest.file)}`)
    : false;
  deps.stdout(`${JSON.stringify({ ref: file, mode: applied.mode, line: prep.line, snapshot: dest.file, written: true, logged })}\n`);
  return 0;
}

function cmdRepair(o, deps, usage) {
  if (!DRIVERS.includes(o.driver)) return usage('--driver must be github-issues or local-files');
  if (!REF_RE.test(o.ref || '')) return usage('--ref must be a positive record number');
  if (!SHA_RE.test(o['expect-sha'] || '')) return usage('--expect-sha must be a sha256 hex digest');
  if (!o['line-file']) return usage('--line-file is required');
  let rawLine;
  try { rawLine = readText(o['line-file']); } catch (err) { return usage(`could not read --line-file (${err.message})`); }
  const dest = snapshotTarget(o, deps);
  if (dest.usage) return usage(dest.usage);
  if (dest.anchor) { deps.stderr(`release-note-repair.js: ${dest.anchor} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md\n`); return 3; }
  return o.driver === 'github-issues' ? repairGithub(o, deps, usage, rawLine, dest) : repairLocal(o, deps, usage, rawLine, dest);
}

function cmdVerify(o, deps, usage) {
  if (!REF_RE.test(o.ref || '')) return usage('--ref must be a positive record number');
  if (!o['before-json'] || !o['after-json'] || !o['line-file']) return usage('--before-json, --after-json and --line-file are required');
  let before;
  let after;
  let rawLine;
  try {
    before = JSON.parse(readText(o['before-json']));
    after = JSON.parse(readText(o['after-json']));
    rawLine = readText(o['line-file']);
  } catch (err) { return usage(`could not read an input file (${err.message})`); }
  const line = detect.checkReleaseNoteLine(rawLine).line;
  const problems = apply.verifyWritten({ before, after, line, checkCli: deps.checkCli });
  if (problems.length) {
    // A labels-only mismatch (the body itself verified clean) is never a restore candidate:
    // `gh issue edit --body-file` can't touch labels, so there is nothing a restore would fix —
    // another actor (e.g. a grant stamping `bot:in-progress`) touched the record after the write
    // landed. Any other problem means the live body itself no longer matches what this run
    // wrote — restoring now would overwrite whatever produced that drift, so it is refused too,
    // just for a different, body-shaped reason (exit 7).
    const labelOnly = problems.length === 1 && /^the label set changed/.test(problems[0]);
    if (labelOnly) {
      deps.stderr(`release-note-repair.js: post-write verification failed — labels changed, body verified:\n  - ${problems[0]}\n`);
      return 8;
    }
    deps.stderr(`release-note-repair.js: post-write verification failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 7;
  }
  const logged = o.run
    ? logAuto(deps, o.run, `filled the Release Note on #${o.ref} with "${line}"; snapshot snapshots/tidy-release-note-${o.ref}.original.md`)
    : false;
  deps.stdout(`${JSON.stringify({ ref: `#${o.ref}`, verified: true, logged })}\n`);
  return 0;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.help) { deps.stdout(USAGE); return 0; }
  const usage = (message) => { deps.stderr(`release-note-repair.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usage(o.error);
  if (o.cmd === 'scan') return cmdScan(o, deps, usage);
  if (o.cmd === 'repair') return cmdRepair(o, deps, usage);
  return cmdVerify(o, deps, usage);
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
