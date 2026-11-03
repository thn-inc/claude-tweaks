#!/usr/bin/env node
// bin/acceptance-packet.js — the acceptance packet's CLI (#4611): snapshot the
// reports a cleanup would remove, gather the facts, render the comment, and
// publish it to a GitHub record or a local-files record. The logic lives in
// bin/lib/wrap-up/packet-*.js; this file reads the inputs and picks the exit code.
//
// Exit vocabulary, Payload-1/Invocation-2 as in bin/wrap-up-engine.js, plus:
//   0 success, including snapshot's two skips (nothing ahead of the base; a snapshot
//     already there on a re-run from the main checkout).
//   1 a payload or write failure: gather's or render's unwritable --out, render's
//     invalid or over-cap input, post's ok:false or unreadable --body-file, local's
//     unreadable record or --body-file or failed write. On any non-zero exit, gather
//     removes an earlier --out and render an earlier --out and --dropped-out, so stale
//     facts or a stale packet are not there to render or post.
//   2 a malformed invocation, post's or local's --body-file with no packet marker on its
//     first line included. Nothing runs, and no MCP fallback is signalled.
//   3 a --run that resolveTarget refuses (gather, snapshot), or a snapshot write
//     failure: the sanctioned writers' "wrong run dir" code (a worktree-local shadow
//     is never read as the run's record, [IL-127]).
//   4 post only: gh is absent, so the caller follows _shared/acceptance-packet.md's
//     MCP path. Its own code because that branch posts, and a malformed call never may.
//
// Every input gather can name is optional. One that will not read becomes a note in
// the facts' `partial` list: the gather's own note where it has one, else the
// `{flag} input not read` note this file adds, so a lost input is never read as an
// empty one. Snapshot copies live in `{run}/packet-inputs/`, and gather reads a copy
// only when the manifest says `copied`, since a later snapshot leaves earlier files.
//
// Snapshot also encodes the walkthrough GIF (#4612), the last moment the QA screenshots are
// guaranteed on disk, and says why not in the manifest's `recording` when it cannot. A failed
// encode or GIF write is that outcome, never a non-zero exit. Gather reads only the manifest.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write');
const { findingItems } = require('./lib/console/resolve');
const { readRecord, writeRecord } = require('./lib/issues/local-store');
const {
  parseRepo, ghAvailable, ghOptions, pinExplicitRepoHost,
} = require('./lib/repo-resolve');
const { sessionTmpPath } = require('./lib/session-tmp');
const {
  GH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES, relativeDisplayId,
} = require('./lib/shared-primitives');
const { safeReal } = require('./lib/hooks/worktree-detect');
const { resolveTarget, findGitRoot } = require('./lib/stage-item/write');
const { readDeclaration, DECLARATION_PATH } = require('./lib/verify/declaration');
const { readQaStamp, QA_STAMP_NAME } = require('./lib/verify/qa-stamp');
const { gitDir } = require('./lib/verify/report');
const { parseNameStatusZ } = require('./lib/git-z');
const { encodeWalkthrough } = require('./lib/walkthrough/encode');
const { decideExposure, readRepoVisibility } = require('./lib/walkthrough/exposure');
const {
  RECORDING_FILE, planRecording, encodeSpec, scrubPaths, recordingLocations,
} = require('./lib/walkthrough/record');
const {
  CLAIM_SECTIONS, EXPOSURES, MAX_PACKET_CHARS, PACKET_MARKER, RECORDING_NOT_RUN_REASONS, SCHEMA_VERSION,
} = require('./lib/wrap-up/packet-contract');
const {
  gatherPacketFacts,
  lowConfidenceFindings,
  qaSelectionFromDecisions,
  expectedChecksFromDeclaration,
  parseStoryFile,
  redactedRecordingStrings,
  storyResultsFromQaReport,
  storiesFromQaStamp,
} = require('./lib/wrap-up/packet-gather');
const { publishPacket, upsertLocalPacket } = require('./lib/wrap-up/packet-post');
const { renderPacket } = require('./lib/wrap-up/packet-render');
const { REASON_KINDS } = require('./lib/wrap-up/packet-validate');

const USAGE = [
  'usage: acceptance-packet.js snapshot --run <dir> --base <ref>',
  '       acceptance-packet.js gather --record <n> --out <file> [--run <dir>] [--spec <file>] [--report <file>] [--scope <file>]',
  '         [--stories-dir <dir>] [--story-results <file>] [--ac-results <file>] [--base <ref>] [--head <ref>] [--links <file>]',
  '         [--surface <s>] [--local-base-url <u>] [--dev-base-url <u>] [--deploy <file>] [--flags <file>] [--decision-items <file>]',
  '       acceptance-packet.js render --facts <file> --narrative <file> --out <file> [--dropped-out <file>] [--observation-plan <file>] [--poster <text>]',
  '       acceptance-packet.js post --record <n> --body-file <file> [--pr <n>] [--label <name>] [--repo <owner/name>]',
  '       acceptance-packet.js local --record-file <file> --body-file <file> [--pending]',
  '  exit 0 ok; 1 payload or write failure; 2 malformed invocation or a --body-file with no packet marker;',
  '  3 --run refused (gather, snapshot) or snapshot write failure; exit 4 post only: gh absent, follow the MCP path',
  '',
].join('\n');

const SUBCOMMANDS = Object.freeze({
  snapshot: { required: ['--run', '--base'], optional: [] },
  gather: {
    required: ['--record', '--out'],
    optional: [
      '--run', '--spec', '--report', '--scope', '--stories-dir', '--story-results', '--ac-results', '--base', '--head', '--links',
      '--surface', '--local-base-url', '--dev-base-url', '--deploy', '--flags', '--decision-items',
    ],
  },
  render: { required: ['--facts', '--narrative', '--out'], optional: ['--dropped-out', '--observation-plan', '--poster'] },
  post: { required: ['--record', '--body-file'], optional: ['--pr', '--label', '--repo'] },
  local: { required: ['--record-file', '--body-file'], optional: [], booleans: ['--pending'] },
});
const INTEGER_FLAGS = Object.freeze(['--record', '--pr']);

const PACKET_INPUTS = 'packet-inputs';
const MANIFEST = 'manifest.json';
const VERIFY_REPORT_COPY = 'verify-report.json';
const QA_REPORT_COPY = 'qa-report.json';
const QA_STAMP_COPY = 'qa-stamp.json';
const VERIFY_REPORT_SOURCE = path.join('claude-tweaks-verify', 'report.json');
const QA_REPORTS_DIR = path.join('.claude-tweaks', 'artifacts', 'screenshots', 'qa');
const QA_REPORT_NAME = 'report.json';
const DEFAULT_STORIES_DIR = 'stories';
const STORY_FILE_RE = /\.ya?ml$/;
const LOG_LINE_RE = /^([0-9a-f]+)\t(.*)$/;
const GH_ABSENT = "gh absent — follow _shared/acceptance-packet.md's MCP path";
const FINDINGS_NOT_READ = 'review findings not read — low-confidence findings not listed';
const RECORDING_NOT_READ = 'manifest recording entry not read — treated as absent';
const ENCODER_FAILED = 'encoder-failed';
const CHECK_IGNORE_NOT_IGNORED = 1;
const UNKNOWN_SECTION = 'unknown';
// What --dropped-out says for a dropped claim whose validator entry carries no known
// `reasonKind`: the free-form `reason` may hold a narrator's value, so it is never written.
const REASON_WITHHELD = 'dropped (reason withheld)';
const FIXED_REASONS = new Set(Object.values(REASON_KINDS));

const flagKey = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const messageOf = (err) => (err && err.message ? err.message : String(err));
const isAbsentError = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
const notReadNote = (flag) => `${flag} input not read — treated as absent`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') return { help: true };
  if (command === undefined) return { error: 'a subcommand is required' };
  if (!Object.hasOwn(SUBCOMMANDS, command)) return { error: `unknown subcommand: ${command}` };
  const { required, optional, booleans = [] } = SUBCOMMANDS[command];
  const valueFlags = [...required, ...optional];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!valueFlags.includes(flag) && !booleans.includes(flag)) return { error: `unknown argument: ${flag}` };
    const key = flagKey(flag);
    if (Object.hasOwn(opts, key)) return { error: `${flag} given more than once` };
    if (booleans.includes(flag)) {
      opts[key] = true;
      continue;
    }
    const value = rest[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) return { error: `${flag} requires a value` };
    if (INTEGER_FLAGS.includes(flag)) {
      if (!/^[1-9][0-9]*$/.test(value)) return { error: `${flag} must be a positive integer, got: ${value}` };
      opts[key] = Number(value);
    } else {
      opts[key] = value;
    }
  }
  const missing = required.find((flag) => !Object.hasOwn(opts, flagKey(flag)));
  if (missing) return { error: `${missing} is required` };
  return { command, opts };
}

const QUIET = ['ignore', 'pipe', 'pipe'];

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  // findingItems' seam: a missing directory is an empty one. Any other failure stays a
  // throw, so it reports that rather than reading a run with no staged items.
  readdir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch (err) {
      if (isAbsentError(err)) return [];
      throw err;
    }
  },
  // Every failure a throw, for a caller that must tell a missing directory from an empty one.
  listDir: (p) => fs.readdirSync(p),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  writeAtomic: (p, s) => writeFileAtomic(p, s),
  removeFile: (p) => fs.unlinkSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  // Frames are binary, and deps.readFile is utf8.
  encodeWalkthrough: (spec) => encodeWalkthrough(spec, { readFile: (p) => fs.readFileSync(p) }),
  readRecord,
  writeRecord,
  // A range's output grows with the branch, and a comment list with the record.
  git: (args) => execFileSync('git', args, {
    encoding: 'utf8', windowsHide: true, stdio: QUIET, timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
  }),
  gh: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', windowsHide: true, stdio: QUIET, timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
  })),
  ghAvailable,
  gitDir: () => gitDir(),
  // An explicit --repo's host reaches every call publishPacket makes, the graphql edit included.
  pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
  tmpPath: (name) => {
    try {
      return sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || path.join(os.tmpdir(), name);
    } catch {
      return path.join(os.tmpdir(), name);
    }
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// The fs seam readQaStamp and readDeclaration take, routed through deps.readFile.
const readerOf = (deps) => ({ readFileSync: (file) => deps.readFile(file) });

function readJsonOrNull(deps, file) {
  try {
    return JSON.parse(deps.readFile(file));
  } catch {
    return null;
  }
}

function readTextOrNull(deps, file) {
  try {
    return deps.readFile(file);
  } catch {
    return null;
  }
}

function gitOrNull(deps, args) {
  try {
    return deps.git(args).trim() || null;
  } catch {
    return null;
  }
}

// A file already gone is the goal. Any other failure is stated: the file is still there.
function removeIfPresent(deps, file) {
  try {
    deps.removeFile(file);
  } catch (err) {
    if (!isAbsentError(err)) deps.stderr(`acceptance-packet.js: could not remove ${file} (${messageOf(err)})\n`);
  }
}

// { dir } when --run is the main checkout's run dir, else null with stderr saying why.
function anchoredRun(run, deps) {
  let target;
  try {
    target = resolveTarget({ runDir: run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  } catch (err) {
    deps.stderr(`acceptance-packet.js: ${messageOf(err)}\n`);
    return null;
  }
  if (target.ok) return target;
  if (target.reason === 'missing') deps.stderr(`acceptance-packet.js: run dir does not exist: ${run}\n`);
  else deps.stderr(`acceptance-packet.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
  return null;
}

// ---- snapshot ----

// What one report source holds: `copied` with its text, `absent`, or `unreadable`.
function readSource(deps, file) {
  let text;
  try {
    text = deps.readFile(file);
  } catch (err) {
    return { status: isAbsentError(err) ? 'absent' : 'unreadable' };
  }
  try {
    return isObject(JSON.parse(text)) ? { status: 'copied', text } : { status: 'unreadable' };
  } catch {
    return { status: 'unreadable' };
  }
}

function stampSource(gitDirPath, head, deps) {
  if (!gitDirPath) return { status: 'absent' };
  const stamp = readQaStamp(gitDirPath, readerOf(deps));
  if (stamp) {
    return stamp.sha === head ? { status: 'copied', text: `${JSON.stringify(stamp, null, 2)}\n`, stamp } : { status: 'absent' };
  }
  const { status } = readSource(deps, path.join(gitDirPath, QA_STAMP_NAME));
  return { status: status === 'absent' ? 'absent' : 'unreadable' };
}

// The newest QA run's report, by directory name. A dir with none is a run that wrote none.
function newestQaReport(deps) {
  const root = path.resolve(deps.cwd(), QA_REPORTS_DIR);
  let names;
  try {
    names = deps.readdir(root);
  } catch {
    return { status: 'unreadable' };
  }
  for (const name of [...names].sort().reverse()) {
    const source = readSource(deps, path.join(root, name, QA_REPORT_NAME));
    if (source.status !== 'absent') return source;
  }
  return { status: 'absent' };
}

function qaReportSource(stamp, runDir, deps) {
  if (typeof stamp?.reportPath === 'string') {
    const source = readSource(deps, path.resolve(deps.cwd(), stamp.reportPath));
    if (source.status !== 'absent') return source;
  }
  // The gate keeps an unrelated older run's report out of a run that selected nothing.
  const decisions = readTextOrNull(deps, path.join(runDir, 'decisions.md'));
  return qaSelectionFromDecisions(decisions) > 0 ? newestQaReport(deps) : { status: 'absent' };
}

// The run dir is anchored, so its nearest `.git` is the main checkout's. A linked
// worktree's own `.git` file is nearer to its cwd, even when it is nested under that root.
function cwdIsMainCheckout(runDir, deps) {
  const cwd = safeReal(deps.cwd());
  return Boolean(cwd) && findGitRoot(cwd)?.dir === findGitRoot(runDir)?.dir;
}

// Each story's screenshot dir as an absolute path, since the frames are read from it directly.
function withAbsoluteScreenshotDirs(report, cwd) {
  if (!Array.isArray(report?.stories)) return report;
  const stories = report.stories.map((story) => (
    typeof story?.screenshot_dir === 'string' && story.screenshot_dir !== ''
      ? { ...story, screenshot_dir: path.resolve(cwd, story.screenshot_dir) }
      : story
  ));
  return { ...report, stories };
}

function planSnapshotRecording({ qaReport, qaStamp, runDir }, deps) {
  const cwd = deps.cwd();
  const report = qaReport.status === 'copied' ? JSON.parse(qaReport.text) : null;
  const storiesDir = typeof report?.stories_dir === 'string' && report.stories_dir.trim() ? report.stories_dir : DEFAULT_STORIES_DIR;
  const indexNotes = [];
  const storyIndex = readStoryIndex(path.resolve(cwd, storiesDir), true, deps, indexNotes);
  return planRecording({
    report: withAbsoluteScreenshotDirs(report, cwd),
    qaExpected: qaReport.status === 'unreadable' || qaStamp.status === 'copied' || qaStamp.status === 'unreadable'
      || qaSelectionFromDecisions(readTextOrNull(deps, path.join(runDir, 'decisions.md'))) > 0,
    storyIndexLost: indexNotes.length > 0,
    storyIndex,
    listFrames: deps.listDir,
  });
}

// An encoder failure names frames by absolute path, and none may reach the fact. They go by
// their known spelling first: a path can hold a space, which scrubPaths cannot see past unquoted.
function recordingFailure(err, framePaths) {
  const named = framePaths.reduce((text, frame) => text.split(frame).join(path.basename(frame)), messageOf(err));
  return { status: 'not-run', reason: ENCODER_FAILED, failure: scrubPaths(named) };
}

// Whether git could commit a GIF written here: the stored pixels are unredacted. check-ignore exits
// 1 for not ignored. Any other failure, a directory in no repository above all, is no such answer.
// `-C`, since the run dir sits in the main checkout and the cwd may be a worktree.
function destinationIsUnignored(dir, deps) {
  try {
    deps.git(['-C', dir, 'check-ignore', '-q', '--', RECORDING_FILE]);
    return false;
  } catch (err) {
    return err?.status === CHECK_IGNORE_NOT_IGNORED;
  }
}

function snapshotRecording(sources, dir, deps) {
  const plan = planSnapshotRecording(sources, deps);
  if (plan.status !== 'ready') return plan;
  if (destinationIsUnignored(dir, deps)) {
    const shown = relativeDisplayId(findGitRoot(dir).dir, path.join(dir, RECORDING_FILE));
    return { status: 'not-run', reason: ENCODER_FAILED, failure: `${shown} is not ignored by git, so the GIF was not written` };
  }
  try {
    const { buffer } = deps.encodeWalkthrough(encodeSpec(plan.frames));
    deps.writeAtomic(path.join(dir, RECORDING_FILE), buffer);
    return {
      status: 'passed',
      file: RECORDING_FILE,
      text: plan.text,
      captions: plan.captions,
      exposure: decideExposure({ repoVisibility: readRepoVisibility(deps.gh), storeProbe: null }),
      frames: plan.frames.length,
    };
  } catch (err) {
    return recordingFailure(err, plan.frames);
  }
}

// The manifest on disk stays raw, as local input. Stdout reaches the transcript, so it prints
// the form a fact would hold.
function printableManifest(manifest) {
  const { redactions: _count, ...strings } = redactedRecordingStrings(manifest.recording);
  return { ...manifest, recording: { ...manifest.recording, ...strings } };
}

function runSnapshot(opts, deps) {
  const target = anchoredRun(opts.run, deps);
  if (!target) return 3;
  const head = gitOrNull(deps, ['rev-parse', 'HEAD']);
  const mergeBase = gitOrNull(deps, ['merge-base', '--end-of-options', opts.base, 'HEAD']);
  // Nothing ahead of the base: a re-run from the main checkout after the merge. Its
  // files are not this run's, and an earlier snapshot may be the only copy.
  if (mergeBase !== null && mergeBase === head) {
    deps.stdout(`${JSON.stringify({ skipped: 'no commits ahead of base' })}\n`);
    return 0;
  }
  // The same hazard when local main is ahead of the base or the merge-base read failed.
  // Any manifest counts, a damaged one included: the main checkout has nothing better.
  const earlier = readSource(deps, path.join(target.dir, PACKET_INPUTS, MANIFEST));
  if (earlier.status !== 'absent' && cwdIsMainCheckout(target.dir, deps)) {
    deps.stdout(`${JSON.stringify({ skipped: 'snapshot exists, re-run from the main checkout' })}\n`);
    return 0;
  }

  let gitDirPath = null;
  try {
    gitDirPath = deps.gitDir();
  } catch {
    // No git dir: the git-dir sources below read as absent.
  }
  const verifyReport = gitDirPath ? readSource(deps, path.join(gitDirPath, VERIFY_REPORT_SOURCE)) : { status: 'absent' };
  const qaStamp = stampSource(gitDirPath, head, deps);
  const qaReport = qaReportSource(qaStamp.stamp, target.dir, deps);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    head,
    mergeBase,
    files: { verifyReport: verifyReport.status, qaReport: qaReport.status, qaStamp: qaStamp.status },
  };

  const dir = path.join(target.dir, PACKET_INPUTS);
  try {
    deps.mkdir(dir);
    for (const [name, source] of [[VERIFY_REPORT_COPY, verifyReport], [QA_REPORT_COPY, qaReport], [QA_STAMP_COPY, qaStamp]]) {
      if (source.status === 'copied') deps.writeAtomic(path.join(dir, name), source.text);
    }
    manifest.recording = snapshotRecording({ qaReport, qaStamp, runDir: target.dir }, dir, deps);
    deps.writeAtomic(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    // An earlier GIF is unredacted pixels that nothing links any more.
    if (manifest.recording.status !== 'passed') removeIfPresent(deps, path.join(dir, RECORDING_FILE));
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not write ${dir} (${messageOf(err)})\n`);
    // A recording here means only the manifest failed: an earlier manifest must not describe this GIF.
    if (manifest.recording?.status === 'passed') removeIfPresent(deps, path.join(dir, RECORDING_FILE));
    return 3;
  }
  deps.stdout(`${JSON.stringify(printableManifest(manifest))}\n`);
  return 0;
}

// ---- gather ----

const NO_SNAPSHOT = Object.freeze({
  head: null, mergeBase: null, report: null, qaReport: null, qaReportUnreadable: false, stamp: null, recording: null, recordingUnread: false,
});

// A damaged manifest entry would otherwise fail the render's fact check, or name another file.
const isStringList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string');
function isRecordingEntry(value) {
  if (!isObject(value)) return false;
  if (value.status === 'not-run') {
    return RECORDING_NOT_RUN_REASONS.includes(value.reason) && (value.failure === undefined || typeof value.failure === 'string');
  }
  return value.status === 'passed' && value.file === RECORDING_FILE && typeof value.text === 'string'
    && isStringList(value.captions) && EXPOSURES.includes(value.exposure);
}

function readSnapshot(runDir, deps) {
  const dir = path.join(runDir, PACKET_INPUTS);
  const manifest = readJsonOrNull(deps, path.join(dir, MANIFEST));
  if (!isObject(manifest)) return NO_SNAPSHOT;
  const files = isObject(manifest.files) ? manifest.files : {};
  const copy = (key, name) => (files[key] === 'copied' ? readJsonOrNull(deps, path.join(dir, name)) : null);
  const qaReport = copy('qaReport', QA_REPORT_COPY);
  const stampCopy = { readFileSync: () => deps.readFile(path.join(dir, QA_STAMP_COPY)) };
  return {
    head: typeof manifest.head === 'string' ? manifest.head : null,
    mergeBase: typeof manifest.mergeBase === 'string' ? manifest.mergeBase : null,
    report: copy('verifyReport', VERIFY_REPORT_COPY),
    qaReport,
    qaReportUnreadable: files.qaReport === 'unreadable' || (files.qaReport === 'copied' && storyResultsFromQaReport(qaReport) === null),
    stamp: files.qaStamp === 'copied' ? readQaStamp(dir, stampCopy) : null,
    recording: isRecordingEntry(manifest.recording) ? manifest.recording : null,
    recordingUnread: manifest.recording !== undefined && !isRecordingEntry(manifest.recording),
  };
}

// Relative to the checkout root, and `/`-joined on every platform: a packet path is a display id.
function recordingPathOf(recording, runDir) {
  if (recording?.status !== 'passed') return null;
  return recordingLocations(relativeDisplayId(findGitRoot(runDir).dir, path.join(runDir, PACKET_INPUTS, recording.file)));
}

function readExpectedChecks(opts, deps) {
  const file = path.resolve(deps.cwd(), opts.scope ?? DECLARATION_PATH);
  const declaration = readDeclaration(file, readerOf(deps));
  if (!declaration.ok) return null;
  return declaration.decl === null ? [] : expectedChecksFromDeclaration(declaration.decl);
}

// Per file, never the joined text: a second file's `stories:` key would drop the first's list.
// A missing or empty directory costs only the negative flags of the stories listed, so
// with none listed it is a project with no stories and states nothing (Decision Q13).
function readStoryIndex(storiesDir, listsStories, deps, notes) {
  if (storiesDir === undefined) return null;
  const stories = [];
  let lost = false;
  try {
    const names = [...deps.listDir(storiesDir)].filter((entry) => STORY_FILE_RE.test(entry)).sort();
    if (names.length === 0) lost = listsStories;
    for (const name of names) {
      const text = readTextOrNull(deps, path.join(storiesDir, name));
      if (text === null) lost = true;
      else stories.push(...parseStoryFile(text));
    }
  } catch (err) {
    lost = !isAbsentError(err) || listsStories;
  }
  if (lost) notes.push(notReadNote('--stories-dir'));
  return stories;
}

function readStampStories(head, snapshot, deps) {
  let stories = null;
  try {
    const sha = deps.git(['rev-parse', '--verify', '--end-of-options', head]).trim();
    stories = storiesFromQaStamp(readQaStamp(deps.gitDir(), readerOf(deps)), sha);
  } catch {
    // Falls through to the snapshot's copy of the stamp.
  }
  return stories ?? storiesFromQaStamp(snapshot.stamp, snapshot.head);
}

function parseChanges(raw) {
  return parseNameStatusZ(raw).map(({ status, paths }) => {
    const moved = status[0] === 'R' || status[0] === 'C';
    if (paths.length !== (moved ? 2 : 1)) throw new Error('truncated diff output');
    return { status: moved ? status[0] : status, path: paths.at(-1) };
  });
}

function parseCommits(raw) {
  return raw.split('\n').map((line) => LOG_LINE_RE.exec(line)).filter(Boolean).map(([, sha, subject]) => ({ sha, subject }));
}

function readChanges(base, head, deps) {
  if (!base) return { changes: null, commits: null };
  try {
    return {
      changes: parseChanges(deps.git(['diff', '--name-status', '-z', '--end-of-options', `${base}...${head}`])),
      commits: parseCommits(deps.git(['log', '--format=%H%x09%s', '--end-of-options', `${base}..${head}`])),
    };
  } catch {
    return { changes: null, commits: null };
  }
}

function readLowConfidence(runDir, deps, notes) {
  try {
    const readStaged = (id) => readTextOrNull(deps, path.join(runDir, 'staged', id));
    return lowConfidenceFindings(findingItems({ runDir, deps }), readStaged);
  } catch {
    notes.push(FINDINGS_NOT_READ);
    return null;
  }
}

const optionalString = (value) => value === undefined || typeof value === 'string';
const isEntryList = (value) => Array.isArray(value) && value.every((entry) => (
  isObject(entry) && typeof entry.id === 'string' && entry.id !== ''
  && ['text', 'url', 'command', 'label'].every((field) => optionalString(entry[field]))
));
const isDeploy = (value) => isObject(value) && typeof value.target === 'string';

function runGather(opts, deps) {
  const code = gatherToFile(opts, deps);
  // An earlier run's facts would still read as this run's, and a caller that ignores the exit code would render them.
  if (code !== 0) removeIfPresent(deps, opts.out);
  return code;
}

function gatherToFile(opts, deps) {
  let runDir = null;
  if (opts.run !== undefined) {
    const target = anchoredRun(opts.run, deps);
    if (!target) return 3;
    runDir = target.dir;
  }

  const notes = [];
  const optionalJson = (flag, isValid) => {
    const file = opts[flagKey(flag)];
    if (file === undefined) return undefined;
    const value = readJsonOrNull(deps, file);
    if (isValid(value)) return value;
    notes.push(notReadNote(flag));
    return undefined;
  };
  const readObject = (file) => {
    if (file === undefined) return null;
    const value = readJsonOrNull(deps, file);
    return isObject(value) ? value : null;
  };

  const snapshot = runDir === null ? NO_SNAPSHOT : readSnapshot(runDir, deps);
  if (snapshot.recordingUnread) notes.push(RECORDING_NOT_READ);
  // A named --report that will not read falls back to the snapshot's copy, and says so.
  const reportFlag = readObject(opts.report);
  if (opts.report !== undefined && reportFlag === null) notes.push(notReadNote('--report'));
  const head = opts.head ?? snapshot.head ?? 'HEAD';
  const base = snapshot.mergeBase ?? opts.base;
  const storyResults = storyResultsFromQaReport(readObject(opts.storyResults)) ?? storyResultsFromQaReport(snapshot.qaReport);
  const stampStories = readStampStories(head, snapshot, deps);
  const listsStories = [...(storyResults ?? []), ...(stampStories ?? [])].some(({ id }) => id !== null);

  let facts;
  try {
    facts = gatherPacketFacts({
      record: opts.record,
      surface: opts.surface,
      localBaseUrl: opts.localBaseUrl,
      devBaseUrl: opts.devBaseUrl,
      specText: opts.spec === undefined ? null : readTextOrNull(deps, opts.spec),
      report: reportFlag ?? snapshot.report,
      expectedChecks: readExpectedChecks(opts, deps),
      acResults: optionalJson('--ac-results', isObject),
      links: optionalJson('--links', isEntryList),
      deploy: optionalJson('--deploy', isDeploy),
      flags: optionalJson('--flags', isEntryList),
      decisions: optionalJson('--decision-items', isEntryList),
      decisionsText: runDir === null ? null : readTextOrNull(deps, path.join(runDir, 'decisions.md')),
      lowConfidence: runDir === null ? null : readLowConfidence(runDir, deps, notes),
      storyIndex: readStoryIndex(opts.storiesDir, listsStories, deps, notes),
      storyResults,
      stampStories,
      qaReportUnread: (opts.storyResults !== undefined && storyResults === null) || snapshot.qaReportUnreadable,
      recording: snapshot.recording,
      recordingPath: recordingPathOf(snapshot.recording, runDir),
      ...readChanges(base, head, deps),
    });
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not gather the facts: ${messageOf(err)}\n`);
    return 1;
  }
  facts.partial.push(...notes);

  try {
    deps.writeFile(opts.out, `${JSON.stringify(facts, null, 2)}\n`);
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not write --out ${opts.out} (${messageOf(err)})\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify({ out: opts.out, facts: facts.facts.length, partial: facts.partial })}\n`);
  return 0;
}

// ---- render ----

// Section and the validator's fixed `reasonKind` only: a claim's text, section and refs
// are the narrator's, this file is a working copy nobody screened, and an entry without a
// known kind is withheld rather than parsed.
function droppedEntry({ claim, reasonKind }) {
  return {
    section: CLAIM_SECTIONS.includes(claim.section) ? claim.section : UNKNOWN_SECTION,
    reason: FIXED_REASONS.has(reasonKind) ? reasonKind : REASON_WITHHELD,
  };
}

function runRender(opts, deps) {
  const code = renderToFiles(opts, deps);
  // An earlier run's files would still read as this run's packet.
  if (code !== 0) {
    removeIfPresent(deps, opts.out);
    if (opts.droppedOut !== undefined) removeIfPresent(deps, opts.droppedOut);
  }
  return code;
}

function renderToFiles(opts, deps) {
  const failInput = (flag, err) => {
    deps.stderr(`acceptance-packet.js: could not read ${flag} (${messageOf(err)})\n`);
    return 1;
  };
  let facts;
  let narrative;
  let observationPlan;
  try {
    facts = JSON.parse(deps.readFile(opts.facts));
  } catch (err) {
    return failInput('--facts', err);
  }
  try {
    narrative = JSON.parse(deps.readFile(opts.narrative));
  } catch (err) {
    return failInput('--narrative', err);
  }
  if (opts.observationPlan !== undefined) {
    try {
      observationPlan = deps.readFile(opts.observationPlan);
    } catch (err) {
      return failInput('--observation-plan', err);
    }
  }

  let rendered;
  try {
    rendered = renderPacket(facts, narrative, { observationPlan, poster: opts.poster });
  } catch (err) {
    deps.stderr(`acceptance-packet.js: invalid packet input: ${messageOf(err)}\n`);
    return 1;
  }
  const { markdown, dropped, screened, truncated, chars } = rendered;
  if (chars > MAX_PACKET_CHARS) {
    deps.stderr(`acceptance-packet.js: packet is ${chars} chars after truncation, over the ${MAX_PACKET_CHARS} cap — nothing written, post nothing\n`);
    return 1;
  }

  try {
    deps.writeFile(opts.out, markdown);
    if (opts.droppedOut !== undefined) {
      // `screened` holds section and key only: the text is the thing screened out.
      deps.writeFile(opts.droppedOut, `${JSON.stringify({
        dropped: dropped.map(droppedEntry), screened, truncated, chars,
      }, null, 2)}\n`);
    }
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not write --out or --dropped-out (${messageOf(err)})\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify({
    out: opts.out, dropped: dropped.length, screened: screened.length, truncated, chars,
  })}\n`);
  return 0;
}

// ---- post ----

const startsWithMarker = (body) => body.split(/\r?\n/, 1)[0] === PACKET_MARKER;

// { body } when --body-file reads and its first line is the packet marker, else { code }
// with stderr saying why: 1 for an unreadable file, 2 for a missing marker. The next run
// finds the comment by that line, so a body without it would become a second packet.
function readPacketBody(opts, deps) {
  let body;
  try {
    body = deps.readFile(opts.bodyFile);
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not read --body-file ${opts.bodyFile} (${messageOf(err)})\n`);
    return { code: 1 };
  }
  if (!startsWithMarker(body)) {
    deps.stderr(`acceptance-packet.js: --body-file ${opts.bodyFile} does not start with the packet marker ${PACKET_MARKER}\n`);
    return { code: 2 };
  }
  return { body };
}

function runPost(opts, deps) {
  let repoSpec = null;
  if (opts.repo !== undefined) {
    // Bare `owner/name` means github.com; `host/owner/name` keeps its host.
    repoSpec = parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`);
    if (!repoSpec) {
      deps.stderr(`acceptance-packet.js: malformed --repo: ${opts.repo}\n${USAGE}`);
      return 2;
    }
  }
  // Ahead of every other check: gh reading a missing file would count as a failed post,
  // which clears a pending label, and the MCP path would post from the same missing file.
  const { code } = readPacketBody(opts, deps);
  if (code !== undefined) return code;
  if (!deps.ghAvailable()) {
    deps.stderr(`acceptance-packet.js: ${GH_ABSENT}\n`);
    return 4;
  }
  if (repoSpec) deps.pinGhHost(repoSpec);

  const tmpPath = opts.pr === undefined ? null : deps.tmpPath(`acceptance-packet-pr-${opts.pr}-${process.pid}.md`);
  let result;
  try {
    result = publishPacket({
      issue: opts.record,
      bodyFile: opts.bodyFile,
      repo: opts.repo ?? null,
      prNumber: opts.pr ?? null,
      label: opts.label ?? null,
      runner: deps.gh,
      writeFile: deps.writeFile,
      tmpPath,
    });
  } finally {
    if (tmpPath !== null) removeIfPresent(deps, tmpPath);
  }
  deps.stdout(`${JSON.stringify(result)}\n`);
  if (!result.ok) deps.stderr(`acceptance-packet.js: ${result.error}\n`);
  return result.ok ? 0 : 1;
}

// ---- local ----

function runLocal(opts, deps) {
  const pending = opts.pending === true;
  const { body: packet, code } = readPacketBody(opts, deps);
  if (code !== undefined) return code;
  try {
    const record = deps.readRecord(opts.recordFile);
    deps.writeRecord(opts.recordFile, {
      title: record.title,
      body: upsertLocalPacket(record.body, packet),
      facets: pending ? { ...record.facets, acceptance: 'pending' } : record.facets,
    });
  } catch (err) {
    deps.stderr(`acceptance-packet.js: could not update ${opts.recordFile} (${messageOf(err)})\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify({ recordFile: opts.recordFile, pending })}\n`);
  return 0;
}

const HANDLERS = Object.freeze({
  snapshot: runSnapshot, gather: runGather, render: runRender, post: runPost, local: runLocal,
});

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.stderr(`acceptance-packet.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  return HANDLERS[parsed.command](parsed.opts, deps);
}

module.exports = { run, parseArgs, droppedEntry };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
