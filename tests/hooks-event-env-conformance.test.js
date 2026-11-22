'use strict';
// #5377: a hook event module reads the environment and the working directory from the context
// hooks.js builds (ctx.env, ctx.cwd), never from the process. Two scans over each listed module's
// source text keep that true as the file grows:
//
//   Scan A: the comment-stripped source names neither `process.env` nor `process.cwd()`.
//   Scan B: every call to `repoInfo(`, `runGit(`, `writeRunState(`, `resolveIntegrationBranch(` and
//           `preferRemoteTrackingRef(` names `env` in its own
//           arguments (balanced parentheses, so a call spanning lines is read whole): at paren depth 0 of
//           the call, outside any nested `(...)` and outside an arrow or function body. The braces and
//           brackets of a plain object or array literal argument (`{ env }`, `{ ...opts, env }`) do not
//           disqualify it. Those
//           three default to the real process.env when `env` is left out, and a git child started
//           without an `env` option inherits it, which no runtime tripwire can see.
//
// Every hook event module is listed (session-start.js joined in Task 5 of #5377), and so are the two
// event-path modules that are not an event's own file: dispatch-prompt-gate.js and skill-invocation.js.
//
// Both scans read blank-mode text (string, template and regex bodies blanked, comments blanked), so a
// message that mentions `process.env` is not code. The verdict is taken on that same text, and a
// mis-parse is an offender. Recall limits, stated rather than hidden: a key spelled as a string
// (`process['env']`), an `env` built into an options object under another name and passed as that
// object (`runGit(a, b, opts)` is flagged: spell `{ env }` in the call, or list the line in
// NAMED_EXCEPTIONS with its reason), a call reached through an alias (`const g = runGit`), an `env`
// that is only a different value under the same word at the top level (`runGit(a, b, other.env)` passes),
// an `env` inside the body of an object method shorthand, a getter or a class body (it still counts),
// and an arrow or function body ended by anything but a top-level comma or the call's close.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

const REPO = path.join(__dirname, '..');
const EVENT_MODULES = [
  'plugin/bin/lib/hooks/pre-tool-use.js',
  'plugin/bin/lib/hooks/post-tool-use.js',
  'plugin/bin/lib/hooks/post-tool-use-failure.js',
  'plugin/bin/lib/hooks/session-end.js',
  'plugin/bin/lib/hooks/pre-compact.js',
  'plugin/bin/lib/hooks/subagent-stop.js',
  'plugin/bin/lib/hooks/user-prompt-submit.js',
  'plugin/bin/lib/hooks/session-start.js',
  'plugin/bin/lib/hooks/dispatch-prompt-gate.js',
  'plugin/bin/lib/hooks/skill-invocation.js',
];
const CALL_NAMES = ['repoInfo', 'runGit', 'writeRunState', 'resolveIntegrationBranch', 'preferRemoteTrackingRef'];

// A call that legitimately reaches its env under another name goes here, keyed by module path then
// call name, with the text of its line and the reason. None today.
const NAMED_EXCEPTIONS = {};

// Calls the module holds today, per call name, per module. A matcher that stops matching drops below.
const FLOORS = {
  'plugin/bin/lib/hooks/pre-tool-use.js': { repoInfo: 9, runGit: 11, writeRunState: 5, resolveIntegrationBranch: 2, preferRemoteTrackingRef: 1 },
  'plugin/bin/lib/hooks/post-tool-use.js': { repoInfo: 0, runGit: 5, writeRunState: 1, resolveIntegrationBranch: 1, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/post-tool-use-failure.js': { repoInfo: 0, runGit: 0, writeRunState: 0, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/session-end.js': { repoInfo: 0, runGit: 0, writeRunState: 1, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/pre-compact.js': { repoInfo: 0, runGit: 0, writeRunState: 1, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/subagent-stop.js': { repoInfo: 0, runGit: 0, writeRunState: 0, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/user-prompt-submit.js': { repoInfo: 0, runGit: 0, writeRunState: 0, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/session-start.js': { repoInfo: 1, runGit: 0, writeRunState: 1, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/dispatch-prompt-gate.js': { repoInfo: 0, runGit: 0, writeRunState: 0, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
  'plugin/bin/lib/hooks/skill-invocation.js': { repoInfo: 0, runGit: 0, writeRunState: 0, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 },
};

function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (src[i] === '\n') line++;
  return line;
}

// Does `args` (the text between a call's own parentheses, blank mode) name `env` at paren depth 0,
// outside an arrow or function body? An arrow or `function` body runs from its start to the next
// comma, or closing bracket, at the level it began at, so a body written with braces or without ends
// correctly. `env` directly before `=>` is an arrow parameter, not a use.
function namesEnvAtTop(args) {
  const stack = [];
  let skipLevel = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (skipLevel !== null) {
      if (c === ',' && stack.length === skipLevel) { skipLevel = null; continue; }
      if (')]}'.includes(c) && stack.length === skipLevel) skipLevel = null;
      else { if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) stack.pop(); continue; }
    }
    if ('([{'.includes(c)) { stack.push(c); continue; }
    if (')]}'.includes(c)) { stack.pop(); continue; }
    if (c === '=' && args[i + 1] === '>') { skipLevel = stack.length; i++; continue; }
    if (/[A-Za-z_$]/.test(c) && !/[\w$]/.test(args[i - 1] || '')) {
      const word = /^[\w$]+/.exec(args.slice(i))[0];
      i += word.length - 1;
      if (word === 'function') { skipLevel = stack.length; continue; }
      if (word === 'env' && !stack.includes('(') && !/^\s*=>/.test(args.slice(i + 1))) return true;
    }
  }
  return false;
}

// Text between the paren at `open` and its matching close paren.
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

// -> { offenders: string[], sites: { [callName]: number } } for one module's raw text.
function scan(raw, rel = 'fixture.js') {
  const offenders = [];
  const sites = Object.fromEntries(CALL_NAMES.map((n) => [n, 0]));
  const code = stripComments(raw, { literals: 'blank' });
  const verdict = stripperVerdict(raw, code);
  if (verdict !== 'ok') {
    offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    return { offenders, sites };
  }
  for (const m of code.matchAll(/(?<![\w$])process\s*\.\s*(env|cwd)\b/g)) {
    offenders.push(`${rel}:${lineOf(code, m.index)}: reads process.${m[1]} (Scan A)`);
  }
  const callRe = new RegExp(`(?<![\\w$])(?:[\\w$]+\\s*\\.\\s*)?(${CALL_NAMES.join('|')})\\s*\\(`, 'g');
  for (const m of code.matchAll(callRe)) {
    if (/function\s+$/.test(code.slice(0, m.index))) continue; // a declaration, not a call
    const line = lineOf(code, m.index);
    sites[m[1]]++;
    const args = balanced(code, m.index + m[0].length - 1);
    if (namesEnvAtTop(args)) continue;
    const lineText = raw.split('\n')[line - 1].trim();
    const exception = (NAMED_EXCEPTIONS[rel] || {})[m[1]];
    if (exception && exception.line === lineText) continue;
    offenders.push(`${rel}:${line}: ${m[1]}( call does not name env (Scan B)`);
  }
  return { offenders, sites };
}

for (const rel of EVENT_MODULES) {
  test(`${rel}: reads no process.env or process.cwd() and passes env to every repoInfo, runGit, writeRunState, resolveIntegrationBranch and preferRemoteTrackingRef call`, () => {
    const { offenders, sites } = scan(readText(path.join(REPO, rel)), rel);
    assert.deepEqual(offenders, [], `an event module read the process, or a call left out env:\n${offenders.join('\n')}`);
    const floor = FLOORS[rel];
    assert.ok(floor, `${rel} has no FLOORS entry`);
    for (const name of CALL_NAMES) {
      assert.ok(
        sites[name] >= floor[name],
        `${rel}: matched ${sites[name]} ${name}( calls, floor ${floor[name]}: a lower count means the matcher stopped matching, not that the calls went away`,
      );
    }
  });
}

test('every event module hooks.js dispatches is in the scan list', () => {
  const code = stripComments(readText(path.join(REPO, 'plugin/bin/hooks.js')));
  const map = /const EVENT_MODULES = \{([\s\S]*?)\n\};/.exec(code);
  assert.ok(map, 'hooks.js no longer declares `const EVENT_MODULES = { ... };`: update this test');
  const dispatched = [...map[1].matchAll(/require\('\.\/(lib\/hooks\/[\w-]+)'\)/g)].map((m) => `plugin/bin/${m[1]}.js`);
  assert.ok(dispatched.length >= 8, `matched ${dispatched.length} EVENT_MODULES entries: the matcher stopped matching`);
  const missing = dispatched.filter((rel) => !EVENT_MODULES.includes(rel));
  assert.deepEqual(missing, [], `hooks.js dispatches event modules the scans do not read: add them to EVENT_MODULES and FLOORS here:\n${missing.join('\n')}`);
});

// --- the matcher flags what it must and nothing else ---

test('self-test: a planted process.env read is flagged with its line', () => {
  const { offenders } = scan('const a = 1;\nconst b = process.env.X;\n');
  assert.deepEqual(offenders, ['fixture.js:2: reads process.env (Scan A)']);
});

test('self-test: a planted process.cwd() read is flagged with its line', () => {
  const { offenders } = scan('const a = 1;\n\nconst c = process.cwd();\n');
  assert.deepEqual(offenders, ['fixture.js:3: reads process.cwd (Scan A)']);
});

test('self-test: process.env in a comment or a string is not code', () => {
  const { offenders } = scan("// process.env.X\n/* process.cwd() */\nconst s = 'process.env.X';\nconst t = `process.cwd()`;\n");
  assert.deepEqual(offenders, []);
});

test('self-test: a planted repoInfo(dir) and runGit(args, cwd) are each flagged with their line', () => {
  const src = 'const a = wtDetect.repoInfo(dir);\nconst b = 1;\nconst r = runGit(args, cwd);\nctxLib.writeRunState(runDir, { x: 1 });\n';
  const { offenders } = scan(src);
  assert.deepEqual(offenders, [
    'fixture.js:1: repoInfo( call does not name env (Scan B)',
    'fixture.js:3: runGit( call does not name env (Scan B)',
    'fixture.js:4: writeRunState( call does not name env (Scan B)',
  ]);
});

test('self-test: a planted resolveIntegrationBranch(root) and preferRemoteTrackingRef(root, name) are each flagged with their line', () => {
  const src = 'const a = bareIntegrationName(resolveIntegrationBranch(worktreePath));\nconst b = 1;\nconst r = preferRemoteTrackingRef(root, name);\n';
  assert.deepEqual(scan(src).offenders, [
    'fixture.js:1: resolveIntegrationBranch( call does not name env (Scan B)',
    'fixture.js:3: preferRemoteTrackingRef( call does not name env (Scan B)',
  ]);
});

test('self-test: resolveIntegrationBranch and preferRemoteTrackingRef calls that name env are not flagged', () => {
  const src = 'resolveIntegrationBranch(root, undefined, { env });\nconst r = preferRemoteTrackingRef(root, name, { env: ctx.env });\n';
  const { offenders, sites } = scan(src);
  assert.deepEqual(offenders, []);
  assert.deepEqual([sites.resolveIntegrationBranch, sites.preferRemoteTrackingRef], [1, 1]);
});

test('self-test: calls that name env are not flagged', () => {
  const src = 'wtDetect.repoInfo(dir, {}, { env });\nrunGit(args, cwd, { env });\nctxLib.writeRunState(d, { a: 1 }, { env: ctx.env });\n';
  const { offenders, sites } = scan(src);
  assert.deepEqual(offenders, []);
  assert.deepEqual(sites, { repoInfo: 1, runGit: 1, writeRunState: 1, resolveIntegrationBranch: 0, preferRemoteTrackingRef: 0 });
});

test('self-test: a call spanning several lines with env on a later line is not flagged', () => {
  const src = 'const r = runGit(\n  args,\n  cwd,\n  { raw: true, env },\n);\n';
  assert.deepEqual(scan(src).offenders, []);
});

test('self-test: env declared after the closing paren does not satisfy a call', () => {
  const src = 'runGit(args, cwd); const env = {};\n';
  assert.deepEqual(scan(src).offenders, ['fixture.js:1: runGit( call does not name env (Scan B)']);
});

test('self-test: env only inside a nested callback does not satisfy a call', () => {
  const { offenders } = scan('ctxLib.writeRunState(runDir, (s) => ({ env: s.x }));\n');
  assert.deepEqual(offenders, ['fixture.js:1: writeRunState( call does not name env (Scan B)']);
});

test('self-test: env only inside a nested call does not satisfy the outer call', () => {
  const { offenders } = scan('runGit(args, repoInfo(dir, {}, { env }).root);\n');
  assert.deepEqual(offenders, ['fixture.js:1: runGit( call does not name env (Scan B)']);
});

test('self-test: env only inside a callback parameter and body does not satisfy a call', () => {
  const { offenders } = scan('runGit(args, cwd, [1].map((env) => env)[0]);\n');
  assert.deepEqual(offenders, ['fixture.js:1: runGit( call does not name env (Scan B)']);
});

test('self-test: env only in a bare-parameter arrow or a function body does not satisfy a call', () => {
  const src = 'writeRunState(d, env => ({ a: env }));\nwriteRunState(d, function (s) { return { env: s }; });\n';
  assert.deepEqual(scan(src).offenders, [
    'fixture.js:1: writeRunState( call does not name env (Scan B)',
    'fixture.js:2: writeRunState( call does not name env (Scan B)',
  ]);
});

test('self-test: env in an object literal argument, beside an arrow or a nested call, still counts', () => {
  const src = [
    'runGit(a, b, { raw: true, env });',
    'runGit(a, b, { ...opts, env: ctx.env });',
    'writeRunState(d, (s) => ({ x: s }), { env: ctx.env });',
    'wtDetect.repoInfo(path.join(a, b), {}, { env });',
    'runGit(a, b, ctx.env);',
  ].join('\n');
  assert.deepEqual(scan(src).offenders, []);
});

test('self-test: a declaration named like a call is not a site', () => {
  const { offenders, sites } = scan('function runGit(args, cwd) {}\n');
  assert.deepEqual(offenders, []);
  assert.equal(sites.runGit, 0);
});

test('self-test: a call after a literal holding a comment opener is still scanned', () => {
  const src = "const g = '/*';\nrunGit(args, cwd);\n";
  assert.deepEqual(scan(src).offenders, ['fixture.js:2: runGit( call does not name env (Scan B)']);
});

test('self-test: a mis-parse is an offender, not a clean scan', () => {
  // The quote inside the regex pairs with the later one in blank mode, which blanks the live call.
  const src = "if (b) /'/.test(b); const c = 'x'; runGit(args, cwd);\n";
  const { offenders } = scan(src);
  assert.equal(offenders.length, 1);
  assert.ok(offenders[0].startsWith('fixture.js: '), offenders[0]);
  assert.ok(offenders[0].includes(STRIPPER_VERDICT_MESSAGES.misparsed), offenders[0]);
});

test('self-test: a file that does not compile is an offender', () => {
  const { offenders } = scan('const = ;\n');
  assert.equal(offenders.length, 1);
  assert.ok(offenders[0].includes(STRIPPER_VERDICT_MESSAGES.unparseable), offenders[0]);
});

test('self-test: a named exception passes only for its exact line', () => {
  const rel = 'exc.js';
  NAMED_EXCEPTIONS[rel] = { runGit: { line: 'runGit(args, cwd, opts);', reason: 'fixture' } };
  try {
    assert.deepEqual(scan('runGit(args, cwd, opts);\n', rel).offenders, []);
    assert.deepEqual(scan('runGit(args, cwd, other);\n', rel).offenders, ['exc.js:1: runGit( call does not name env (Scan B)']);
  } finally {
    delete NAMED_EXCEPTIONS[rel];
  }
});
