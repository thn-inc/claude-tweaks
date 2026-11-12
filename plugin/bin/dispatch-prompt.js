#!/usr/bin/env node
// bin/dispatch-prompt.js — renders one /claude-tweaks:dispatch Task() prompt (#4589).
//   node bin/dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M...]
//        [--out <file>] [--next-steps <value>] [--headless] [--resume-verdict <file>]
//        [--selected-at <ISO|unknown>] [--help]
// The dispatching session used to hand-substitute the fenced templates in
// skills/dispatch/task-prompt.md. This CLI reads that same file, fills the closed placeholder set
// (bin/lib/dispatch/task-prompt.js), writes the prompt to --out (default: the session temp path
// dispatch-prompt-{run-id}-{call}.md), writes it again as {out}.part1..N when it exceeds one
// readable chunk, and appends one line {sha256, call, out, chunks, issues, at} to
// {run}/dispatch-prompts.jsonl. That registry feeds bin/lib/hooks/dispatch-prompt-gate.js, which
// denies a Task() prompt whose digest is not in it. stdout: exactly one JSON line
// {out, bytes, chunks:[{path,bytes}], join, call, issues, continuation, resume, profile, selectedAt,
// sha256}; the prompt itself never goes to stdout. The session reads each chunk path and joins them
// by `join` ('\n'); the join is byte-identical to the file at `out`.
// Exit codes (mirroring compose-context.js): 0 rendered; 1 failure (template unreadable or
// unparseable, a resolver failed, a placeholder left, prompt over the MAX_PROMPT_BYTES sanity bound
// or with no valid chunk split, --resume-verdict unreadable or not JSON, --out or the registry
// unwritable); 2 malformed invocation (an invalid --next-steps, no --out and no session id, a
// resume combined with a second call/--headless/several issues/an ineligible verdict) or a --run
// that is missing or refused. On exit 1/2 nothing is written to --out or its parts and nothing is
// appended to the registry, except one case: a registry append that fails after the writes is
// exit 1 (the prompt was never recorded, so the gate would deny it).
// --run guard is shape 4 of the cli-wrapper contract, as in compose-context.js: bin/lib/run-dir-guard.js's
// anchored-or-outside rule — a path outside any checkout is accepted, a worktree-local shadow is refused.
// A non-zero exit is never followed by hand substitution (two-call-gate.md section 2): the caller reports it.
// The CLI makes no size comparison itself; promptSize and chunkPrompt in the lib own every bound.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { anchoredOrOutsideMessage } = require('./lib/run-dir-guard');
const { sessionTmpRoot, sessionTmpPath } = require('./lib/session-tmp');
const { parseNextSteps, FIRST_CALL_STEPS, SECOND_CALL_STEPS } = require('./lib/dispatch/first-call-artifact-check');
const {
  renderTaskPrompt, extractTemplates, profileOf, promptDigest, promptSize, MAX_PROMPT_BYTES,
  chunkPrompt, REGISTRY_FILE,
} = require('./lib/dispatch/task-prompt');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(PLUGIN_ROOT, 'skills', 'dispatch', 'task-prompt.md');
const POLICY_KEYS = ['autonomy', 'integration-model', 'merge-verification', 'risk-floor', 'size-floor'];
const USAGE = 'usage: dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M...] [--out <file>]\n'
  + '       [--next-steps <value>] [--headless] [--resume-verdict <file>] [--selected-at <ISO|unknown>] [--help]\n';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const VALUE_FLAGS = Object.freeze({
  '--call': 'call', '--run': 'run', '--issues': 'issues', '--out': 'out', '--next-steps': 'nextSteps',
  '--resume-verdict': 'resumeVerdict', '--selected-at': 'selectedAt',
});
const BOOL_FLAGS = Object.freeze({ '--headless': 'headless', '--help': 'help', '-h': 'help' });

function parseArgs(argv) {
  const o = {
    call: null, run: null, issues: null, out: null, nextSteps: null, resumeVerdict: null,
    selectedAt: null, headless: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.hasOwn(BOOL_FLAGS, a)) { o[BOOL_FLAGS[a]] = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[VALUE_FLAGS[a]] = v;
  }
  return o;
}

function parseIssues(raw) {
  const parts = raw.split(',');
  if (!parts.every((p) => /^[1-9]\d*$/.test(p))) return { error: `--issues must be positive integers, comma-separated (got ${JSON.stringify(raw)})` };
  const issues = parts.map(Number);
  if (new Set(issues).size !== issues.length) return { error: '--issues must not repeat a number' };
  return { issues };
}

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  anchoredOrOutsideMessage,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  appendFile: (p, s) => fs.appendFileSync(p, s),
  resolvePolicyValues: (cwd) => {
    const out = execFileSync(process.execPath,
      [path.join(PLUGIN_ROOT, 'bin', 'resolve-policy.js'), '--values', POLICY_KEYS.join(',')],
      { cwd, encoding: 'utf8', windowsHide: true });
    const lines = out.split('\n');
    if (lines.length < POLICY_KEYS.length) throw new Error('resolve-policy.js printed fewer lines than keys requested');
    return POLICY_KEYS.map((k, i) => `${k}=${lines[i].trim() || '(unset)'}`).join(', ');
  },
  resolveProfile: (name, { unattended, cwd }) => {
    const args = [path.join(PLUGIN_ROOT, 'bin', 'resolve-profile.js'), name];
    if (unattended) args.push('--unattended');
    return JSON.parse(execFileSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true }));
  },
  selectedAt: () => {
    try {
      const root = sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID);
      if (!root) return 'unknown';
      return fs.statSync(path.join(root, 'dispatch-groups.json')).mtime.toISOString();
    } catch { return 'unknown'; }
  },
  defaultOut: (runId, call) => sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, `dispatch-prompt-${runId}-${call}.md`),
  now: () => new Date().toISOString(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const fail = (code, message) => { d.stderr(`dispatch-prompt.js: ${message}\n`); return code; };
  const usageError = (message) => { d.stderr(`dispatch-prompt.js: ${message}\n${USAGE}`); return 2; };
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { d.stdout(USAGE); return 0; }
  if (o.call !== 'first' && o.call !== 'second') return usageError('--call first|second is required');
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.issues) return usageError('--issues N[,M...] is required');
  const parsedIssues = parseIssues(o.issues);
  if (parsedIssues.error) return usageError(parsedIssues.error);
  const issues = parsedIssues.issues;
  const call = o.call;
  if (o.selectedAt !== null && o.selectedAt !== 'unknown' && !ISO_RE.test(o.selectedAt)) {
    return usageError('--selected-at must be an ISO timestamp or "unknown"');
  }
  if (o.headless && call !== 'first') return usageError('--headless applies to the first call only');
  if (o.resumeVerdict) {
    if (call !== 'first') return usageError('--resume-verdict applies to the first call only');
    if (o.headless) return usageError('--resume-verdict excludes --headless (a resume is human-typed)');
    if (issues.length !== 1) return usageError('--resume-verdict needs exactly one issue');
  }

  let cwd;
  try { cwd = d.cwd(); } catch (err) { return fail(1, err && err.message); }
  const runDir = path.resolve(cwd, o.run);
  let isDir;
  try { isDir = d.isDirectory(runDir); } catch (err) { return fail(1, err && err.message); }
  if (!isDir) return fail(2, `--run ${o.run} is not a directory`);
  let rejection;
  try { rejection = d.anchoredOrOutsideMessage(runDir, cwd, '--run'); } catch (err) { return fail(2, err && err.message); }
  if (rejection) return fail(2, rejection);
  const runId = path.basename(runDir);

  let out = null;
  try { out = o.out ? path.resolve(cwd, o.out) : d.defaultOut(runId, call); } catch (err) { return fail(1, err && err.message); }
  if (!out) return usageError('no --out and no session id (CLAUDE_CODE_SESSION_ID) to derive a default path from');

  let stepToken = null;
  if (o.nextSteps !== null) {
    const parsed = parseNextSteps(`NEXT_STEPS: ${o.nextSteps}`,
      call === 'first' ? FIRST_CALL_STEPS : SECOND_CALL_STEPS, { targets: issues.map((n) => `#${n}`) });
    if (!parsed.ok) return usageError(`--next-steps refused: ${parsed.message}`);
    stepToken = parsed.stepArg || parsed.steps.join(',');
  }

  let resume = null;
  if (o.resumeVerdict) {
    let verdict;
    try { verdict = JSON.parse(d.readFile(path.resolve(cwd, o.resumeVerdict))); } catch (err) {
      return fail(1, `--resume-verdict ${o.resumeVerdict} unreadable or not JSON: ${err && err.message}`);
    }
    if (!verdict || verdict.eligible !== true) return usageError('--resume-verdict is not eligible');
    if (verdict.issue !== issues[0]) return usageError('--resume-verdict names a different issue than --issues');
    resume = verdict;
  }

  let text;
  try { text = d.readFile(TEMPLATE_PATH); } catch (err) { return fail(1, `template ${TEMPLATE_PATH} unreadable: ${err && err.message}`); }
  let prompt;
  let profile;
  let profileName;
  let selectedAt;
  try {
    profileName = profileOf(extractTemplates(text)[call]);
    const policyValues = d.resolvePolicyValues(cwd);
    profile = d.resolveProfile(profileName, { unattended: o.headless, cwd });
    selectedAt = o.selectedAt !== null ? o.selectedAt : d.selectedAt();
    prompt = renderTaskPrompt(text, {
      call, issues, runDir, pluginRoot: PLUGIN_ROOT, policyValues, selectedAt,
      headless: o.headless, stepToken: stepToken || undefined, resume: resume || undefined,
      effortLine: profile.effortLine,
    });
  } catch (err) { return fail(1, err && err.message); }

  const size = promptSize(prompt);
  if (!size.ok) return fail(1, `dispatch-prompt: rendered prompt is ${size.bytes} bytes, over the ${MAX_PROMPT_BYTES}-byte sanity bound (#4589)`);
  let chunks;
  try { chunks = chunkPrompt(prompt); } catch (err) { return fail(1, err && err.message); }

  const registry = path.join(runDir, REGISTRY_FILE);
  const sha256 = promptDigest(prompt);
  const parts = chunks.map((c, i) => ({ path: `${out}.part${i + 1}`, text: c }));
  let target = out;
  try {
    d.writeFile(out, prompt);
    parts.forEach((p) => { target = p.path; d.writeFile(p.path, p.text); });
  } catch (err) { return fail(1, `cannot write ${target}: ${err && err.message}`); }
  try {
    d.appendFile(registry, `${JSON.stringify({ sha256, call, out, chunks: chunks.length, issues, at: d.now() })}\n`);
  } catch (err) { return fail(1, `cannot append to the registry ${registry}: ${err && err.message}`); }

  d.stdout(`${JSON.stringify({
    out,
    bytes: size.bytes,
    chunks: parts.map((p) => ({ path: p.path, bytes: Buffer.byteLength(p.text, 'utf8') })),
    join: '\n',
    call,
    issues,
    continuation: stepToken !== null,
    resume: resume !== null,
    profile: { name: profileName, model: profile.model, effort: profile.effort, source: profile.source },
    selectedAt,
    sha256,
  })}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2), realDeps);
  } catch (err) {
    process.stderr.write(`dispatch-prompt.js: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run, parseArgs, realDeps };
