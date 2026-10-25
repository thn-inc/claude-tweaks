#!/usr/bin/env node
// bin/shadow-dup-proposal.js — compose a fileable Queue-writes proposal for a
// divergent or collision `.shadow-dup` copy in a run's staged/ (#3946).
//   node bin/shadow-dup-proposal.js --run <run-dir> --item <staged-name> --out <file> [--help]
// Reads staged/<item> (the copy) and staged/<anchor> (the name minus its
// `.shadow-dup[-n]` suffix; absent or unreadable reads as no anchor), and writes
// the `Title:`/`Type:`/`Labels:`/`Defer-reason:` header + spec-shaped body that
// quotes the copy verbatim (and, for a divergent copy, the anchor verbatim too) to
// --out (bin/lib/console/shadow-dup-proposal.js).
// The Review Console's Queue-writes step files that proposal.
// Exit 0 on success (--out written; its path echoed to stdout); 2 on a malformed
// invocation (a missing/unknown flag, an --item that is not a plain filename or
// not a shadow-dup name, an item absent from staged/, an unreadable copy — a leaf
// symlink included (readNoFollow below; a symlinked anchor reads as missing) — or a
// byte-identical duplicate — refused, the console dismisses it; reopen this exit-2
// overload if a console step must retry an unreadable copy differently from
// dismissing a duplicate); 3 when the run dir is missing or not anchored under
// the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md's
// Anchoring section, [IL-127]), or --out is unwritable. This is the
// Sanctioned-writer vocabulary (no exit 1), though the run dir is only read: the
// one write is the caller-named --out, a create-or-overwrite with no lock, so a
// caller reusing a path owns that.
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveTarget, sanitizeId } = require('./lib/stage-item/write');
const { composeShadowDupProposal } = require('./lib/console/shadow-dup-proposal');
const { SHADOW_DUP_RE, runIdOf } = require('./lib/console/resolve');

const USAGE = 'usage: shadow-dup-proposal.js --run <run-dir> --item <staged-name> --out <file> [--help]\n'
  + '  exit 0 wrote --out; 2 malformed invocation (incl. a byte-identical duplicate, refused); 3 run dir missing/not anchored, or --out unwritable\n';

const VALUE_FLAGS = { '--run': 'run', '--item': 'item', '--out': 'out' };

function parseArgs(argv) {
  const o = { run: null, item: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    o[VALUE_FLAGS[a]] = v;
  }
  return o;
}

// The copy and anchor are quoted verbatim into a filed record, so a leaf symlink
// in staged/ must never pull an outside file in: O_NOFOLLOW makes opening one fail
// (ELOOP), which reads as an unreadable copy or a missing anchor. (0 where the
// platform has no such flag.)
function readNoFollow(p) {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  readFile: readNoFollow,
  writeFile: (p, s) => fs.writeFileSync(p, s),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`shadow-dup-proposal.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.item) return usageError('--item <staged-name> is required');
  if (!o.out) return usageError('--out <file> is required');
  const item = sanitizeId(o.item);
  if (!item) return usageError(`--item must be a plain staged filename (letters, digits, ., _, - — no path separators): ${JSON.stringify(o.item)}`);
  const match = SHADOW_DUP_RE.exec(item);
  if (!match) return usageError(`--item ${item} is not a shadow-dup copy (expected "<name>.shadow-dup" or "<name>.shadow-dup-<n>")`);

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`shadow-dup-proposal.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`shadow-dup-proposal.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`shadow-dup-proposal.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  const stagedDir = path.join(target.dir, 'staged');
  let text = null;
  let readError = null;
  try { text = deps.readFile(path.join(stagedDir, item)); } catch (err) { readError = err; }
  let anchorText = null;
  try { anchorText = deps.readFile(path.join(stagedDir, match[1])); } catch { /* absent or unreadable anchor reads as no anchor */ }

  const composed = composeShadowDupProposal({
    name: item, text, anchorText, runId: runIdOf(target.dir),
  });
  if (!composed.ok) {
    if (composed.reason === 'shadow-dup-duplicate') deps.stderr('shadow-dup-proposal.js: refused (shadow-dup-duplicate): dismissed, nothing to file\n');
    else if (composed.reason === 'copy-unreadable') deps.stderr(`shadow-dup-proposal.js: refused (copy-unreadable): could not read staged/${item} (${readError ? readError.message : 'not a string'})\n`);
    else deps.stderr(`shadow-dup-proposal.js: refused (${composed.reason})\n`);
    return 2;
  }

  const outPath = path.resolve(deps.cwd(), o.out);
  try { deps.writeFile(outPath, composed.proposal); } catch (err) {
    deps.stderr(`shadow-dup-proposal.js: could not write --out ${o.out} (${err && err.message})\n`);
    return 3;
  }
  deps.stdout(outPath + '\n');
  return 0;
}

module.exports = { run, parseArgs, USAGE, readNoFollow };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
