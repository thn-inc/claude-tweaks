#!/usr/bin/env node
// bin/design-session.js
//
// The mechanical half of /claude-tweaks:design: where a session's folder is,
// which step it resumes at, whether its evidence and a notes round are
// complete, and the exact text each reader is handed. A thin shell over
// bin/lib/design-session/{folder,status,evidence,notes,brief}.js; no judgement
// lives here. Zero runtime npm deps. The entry contract is
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
//
// Usage:
//   design-session.js folder --topic <text> --root <repo> [--create]
//       Prints the absolute session folder (docs/superpowers/specs/{date}-{slug}
//       under --root; an existing folder for the slug is reused). --create makes it.
//   design-session.js status --folder <dir>
//       Prints { steps, resumeAt, round, action, openSerious } as JSON.
//   design-session.js check-evidence --folder <dir>
//       Prints { done, unsourced, unclosedFence } as JSON.
//   design-session.js check-notes --folder <dir> --round <N>
//       Prints { ok, pending, serious, missingPerspectives, malformed } as JSON.
//   design-session.js brief --folder <dir> --reader <name> [--round <N>]
//       Prints the reader's prompt text. --round is required for a perspective
//       reader (user, smallest, ownership, token-cost, introduction) and ignored
//       for pre-mortem and builder.
//   design-session.js --help
//
// Exit codes: 0/1/2, shaped like the Payload-1/Invocation-2 family but not a
// member — there, 1 is a bad payload; here a failed check or refused brief is
// a verdict the calling prose branches on, so it is data:
//   0  success; for the check-* verbs, the check passed
//   1  a check failed or a brief was refused — stdout carries the JSON naming why
//      (brief: { ok: false, reason, detail }, reason one of round-cap,
//      pending-outcomes, no-frame, no-storyboard, stale-storyboard, symlink,
//      unknown-reader)
//   2  malformed invocation, or a folder or file the caller named that cannot be
//      read (stderr says which). A missing evidence.md or notes-round-N.md is 2,
//      not 1: the calling step has just written it, so absence means a wrong
//      --folder or --round, which no caller handles differently from a bad call.

'use strict';

const fs = require('fs');
const path = require('path');
const { lstatType } = require('./lib/path-guard');
const { slugFor, findFolder } = require('./lib/design-session/folder');
const { readStatus } = require('./lib/design-session/status');
const { checkEvidence } = require('./lib/design-session/evidence');
const { PERSPECTIVES, checkNotes } = require('./lib/design-session/notes');
const { composeBrief } = require('./lib/design-session/brief');

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_INVOCATION = 2;

const SPECS_DIR = path.join('docs', 'superpowers', 'specs');
const BRIEFS_FILE = path.join(__dirname, '..', 'skills', 'design', 'reader-briefs.md');

const USAGE = [
  'Usage:',
  '  design-session.js folder --topic <text> --root <repo> [--create]',
  '  design-session.js status --folder <dir>',
  '  design-session.js check-evidence --folder <dir>',
  '  design-session.js check-notes --folder <dir> --round <N>',
  '  design-session.js brief --folder <dir> --reader <name> [--round <N>]',
  '  design-session.js --help',
  '',
  'Flags:',
  '  --topic <text>    the session topic, or an issue ref (#N)',
  '  --root <repo>     the repository root holding docs/superpowers/specs',
  '  --create          create the folder (folder only)',
  '  --folder <dir>    the session folder, relative to the current directory or absolute',
  '  --round <N>       the notes round, 1 to 4',
  '  --reader <name>   user | smallest | ownership | token-cost | introduction | pre-mortem | builder',
  '',
  'Exit: 0 ok / check passed, 1 check failed or brief refused (JSON on stdout), 2 malformed invocation.',
  '',
].join('\n');

const VALUE_FLAGS = new Set(['--topic', '--root', '--folder', '--round', '--reader']);
const BOOL_FLAGS = new Set(['--create']);
const VERBS = new Set(['folder', 'status', 'check-evidence', 'check-notes', 'brief']);

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { verb: null, flags: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      if (Object.hasOwn(out.flags, a)) throw new UsageError(`${a} given twice`);
      out.flags[a] = v;
    } else if (BOOL_FLAGS.has(a)) {
      out.flags[a] = true;
    } else if (a.startsWith('-')) {
      throw new UsageError(`unknown flag ${a}`);
    } else if (out.verb === null && VERBS.has(a)) {
      out.verb = a;
    } else {
      throw new UsageError(`unexpected argument '${a}'`);
    }
  }
  return out;
}

function today(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// A relative path resolves against deps.cwd(); an absolute one never reads it.
// path.resolve, not resolveAgainst: the folder is printed and embedded in a
// brief, so one absolute normalized value is needed.
function resolveIn(deps, p) {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(deps.cwd(), p);
}

function need(flags, names) {
  for (const n of names) {
    if (flags[n] === undefined) throw new UsageError(`${n} is required`);
  }
}

function parseRound(flags) {
  if (!/^[1-9]\d*$/.test(flags['--round'])) throw new UsageError('--round must be a positive integer');
  return Number(flags['--round']);
}

function existingFolder(deps, flags) {
  const folder = resolveIn(deps, flags['--folder']);
  const t = lstatType(folder, { fsImpl: deps.fs });
  if (t.type !== 'directory') throw new UsageError(`--folder is not a directory: ${folder}`);
  return folder;
}

function readFileOrUsage(deps, file, what) {
  try {
    return deps.fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) throw new UsageError(`${what} not found: ${file}`);
    throw err;
  }
}

function json(deps, value) {
  deps.stdout(`${JSON.stringify(value)}\n`);
}

function runVerb(verb, flags, deps) {
  if (flags['--create'] && verb !== 'folder') throw new UsageError('--create applies only to the folder verb');
  if (verb === 'folder') {
    need(flags, ['--topic', '--root']);
    let slug;
    try {
      slug = slugFor(flags['--topic']);
    } catch (err) {
      throw new UsageError(`--topic has nothing to name a folder after (${err.message})`);
    }
    const specsDir = path.join(resolveIn(deps, flags['--root']), SPECS_DIR);
    const { folder } = findFolder({ specsDir, slug, today: today(deps.now()) }, deps.fs);
    if (flags['--create']) deps.fs.mkdirSync(folder, { recursive: true });
    deps.stdout(`${folder}\n`);
    return EXIT_OK;
  }

  need(flags, ['--folder']);
  const folder = existingFolder(deps, flags);

  if (verb === 'status') {
    json(deps, readStatus(folder, deps.fs));
    return EXIT_OK;
  }

  if (verb === 'check-evidence') {
    const r = checkEvidence(readFileOrUsage(deps, path.join(folder, 'evidence.md'), 'evidence.md'));
    json(deps, r);
    return r.done && r.unsourced.length === 0 && !r.unclosedFence ? EXIT_OK : EXIT_REFUSED;
  }

  if (verb === 'check-notes') {
    need(flags, ['--round']);
    const round = parseRound(flags);
    const file = `notes-round-${round}.md`;
    const r = checkNotes(readFileOrUsage(deps, path.join(folder, file), file), round);
    json(deps, r);
    return r.ok ? EXIT_OK : EXIT_REFUSED;
  }

  // brief
  need(flags, ['--reader']);
  const reader = flags['--reader'];
  const round = flags['--round'] === undefined ? undefined : parseRound(flags);
  if (round === undefined && PERSPECTIVES.includes(reader)) {
    throw new UsageError('--round is required for a perspective reader');
  }
  const briefsText = readFileOrUsage(deps, deps.briefsFile, 'reader-briefs.md');
  const r = composeBrief({ folder, reader, round, briefsText }, deps.fs);
  if (r.ok) {
    deps.stdout(`${r.text}\n`);
    return EXIT_OK;
  }
  json(deps, r);
  return EXIT_REFUSED;
}

function run(argv, deps) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    deps.stderr(`design-session.js: ${err.message}\n${USAGE}`);
    return EXIT_INVOCATION;
  }
  if (args.help) {
    deps.stdout(USAGE);
    return EXIT_OK;
  }
  if (args.verb === null) {
    deps.stderr(`design-session.js: a verb is required\n${USAGE}`);
    return EXIT_INVOCATION;
  }
  try {
    return runVerb(args.verb, args.flags, deps);
  } catch (err) {
    deps.stderr(`design-session.js: ${err instanceof UsageError ? '' : `${args.verb} failed — `}${err && err.message}\n`);
    return EXIT_INVOCATION;
  }
}

const realDeps = {
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
  cwd: () => process.cwd(),
  now: () => new Date(),
  fs,
  briefsFile: BRIEFS_FILE,
};

module.exports = { run, realDeps, parseArgs, USAGE, EXIT_OK, EXIT_REFUSED, EXIT_INVOCATION };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
