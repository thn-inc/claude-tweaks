'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// Every `gh` spawn under plugin/bin/ routes its options through repo-resolve.js's
// `ghOptions(args, opts)` seam. The seam injects GH_HOST for a GitHub Enterprise origin; a spawn that skips it sends
// its call to github.com on a `*.ghe.com` origin. #4505 migrated every site at once, and
// this scan keeps a new call site from regressing that fix.
//
// The scan reads two stripped texts with the same offsets. Literal-keeping mode
// supplies a literal's contents. Blank mode (`literals: 'blank'`) supplies structure:
// literal bodies are blanked there, so a bracket, comma or quote inside a string never
// moves a call's argument boundaries, and a `ghOptions` named inside a message string
// does not count as the seam. A file either text mis-parses in is an offender.
//
// A `'gh'` / `"gh"` / `` `gh` `` literal is a site when it is
//   (a) a whole top-level argument, in any position, of a call expression. The call is
//       compliant when its balanced argument text names the identifier `ghOptions`
//       (`execFileSync('gh', args, ghOptions(args, {…}))`,
//       `makeDefaultRunner('gh', ghOptions)`, `execBounded(deps, 'gh', args, cwd, ghOptions)`);
//   (b) the first element of an array literal (an argv such as `['gh', 'pr', 'list']`).
// A string or template literal beginning `gh ` passed to a callee whose name matches
// /exec|spawn/i is a site too (c, the shell form). (b) and (c) are always offenders: the
// seam takes an argv beside its options, and a shell string is banned outright
// (gh-api-module-pattern: "always an argv array, never a shell string").
//
// Recall limits: a command name reached through a variable (`const GH = 'gh';
// execFileSync(GH, …)`), a computed argument (`cond ? 'gh' : x`) or a concatenated shell
// string (`'gh' + ' pr list'`) is not a site, since only a literal that is the whole
// argument counts. Nor is an object-property form (`{ cmd: 'gh' }` passed to
// `spawn(spec.cmd, …)`): a literal inside `{…}` is neither an argument nor an array
// element. A comparison (`exe === 'gh'`), a default (`transport = 'gh'`) and a
// non-first array element are not sites by design.
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');
const BLANK = { literals: 'blank' };
const SEAM = /\bghOptions\b/;
// A word before `(` that makes it a grouping or statement paren, not a call; before `[`,
// one that makes it an array literal, not a member access.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'void', 'await',
  'in', 'of', 'case', 'delete', 'throw', 'yield', 'instanceof', 'else', 'do', 'new']);

// The seam itself: `ghAvailable`'s `gh --version` probe asks no host.
const EXEMPT = new Set(['lib/repo-resolve.js']);

// Non-spawn `gh` literals the matcher flags, keyed file -> exact offender count. Each
// count was settled by reading the line. A spawn site is never listed here.
const ALLOWED = {
  'lib/residue/probes/forge.js': { count: 1, reason: "an argv array (`['gh', 'pr', 'list', …]`) handed to residue.js's runner, which wraps a `gh` argv in ghOptions (`argv[0] === 'gh' ? ghOptions : …`)" },
  'lib/reconcile/issue-list-cache.js': { count: 1, reason: "`recordSubprocess('gh', argv, ms)` records a finished call's duration for the reconcile timings; it spawns nothing" },
  'lib/compose-context/compose.js': { count: 1, reason: "`transport: ['gh', 'mcp']`, the allowed-values enum of a compose-context condition key" },
};

// Text between the bracket at `open` and its matching close.
function balanced(src, open, openCh = '(', closeCh = ')') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

// The last top-level comma-separated argument of `args`.
function lastTopLevelArg(args) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) start = i + 1;
  }
  return args.slice(start).trim();
}

// Index of the innermost bracket enclosing `at`, or -1 at top level.
function enclosingOpen(src, at) {
  let depth = 0;
  for (let j = at - 1; j >= 0; j--) {
    const c = src[j];
    if (')]}'.includes(c)) depth++;
    else if ('([{'.includes(c)) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

// The non-space character before `at`, and the identifier ending there when it is one.
function before(src, at) {
  let j = at - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  const m = /[A-Za-z_$][\w$]*$/.exec(src.slice(Math.max(0, j - 80), j + 1));
  return { ch: src[j] || '', word: m ? m[0] : '' };
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

// Kind of the bracket at `open`: 'call' (with its callee word), 'array', or null.
function bracketKind(blank, open) {
  const { ch, word } = before(blank, open);
  const isCallee = (ch === ')' || ch === ']' || /[\w$]/.test(ch)) && !KEYWORDS.has(word);
  if (blank[open] === '(') return isCallee ? { kind: 'call', callee: word } : null;
  if (blank[open] === '[') return isCallee ? null : { kind: 'array' };
  return null;
}

// Does the top-level argument holding `at` start at `at` (and, given `end`, end there)?
function wholeArg(blank, open, at, end) {
  const args = blank.slice(open + 1, at);
  if (lastTopLevelArg(args) !== '') return false;
  if (end === undefined) return true;
  const rest = blank.slice(end).trimStart();
  return rest.startsWith(',') || rest.startsWith(')');
}

// -> { verdict, sites: [{ line, text, ok }] } for every `gh` literal site in `raw`.
function ghSites(raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, BLANK);
  const verdict = [keep, blank].map((text) => stripperVerdict(raw, text)).find((v) => v !== 'ok') || 'ok';
  const sites = [];
  const site = (open, ok, form) => {
    const close = open + 1 + balanced(blank, open, blank[open], blank[open] === '(' ? ')' : ']').length + 1;
    const text = keep.slice(open - before(blank, open).word.length, close).replace(/\s+/g, ' ').slice(0, 100);
    sites.push({ line: lineOf(blank, open), text: `${form}: ${text}`, ok });
  };
  // A `gh` literal. One that sits inside a longer literal never passes the start checks
  // below: in blank mode the outer literal's opening delimiter precedes it in the same
  // argument or element.
  for (const m of keep.matchAll(/(['"`])gh\1/g)) {
    const at = m.index;
    const open = enclosingOpen(blank, at);
    if (open < 0) continue;
    const kind = bracketKind(blank, open);
    if (kind && kind.kind === 'call' && wholeArg(blank, open, at, at + 4)) {
      site(open, SEAM.test(balanced(blank, open)), 'gh call without ghOptions');
    } else if (kind && kind.kind === 'array' && blank.slice(open + 1, at).trim() === '') {
      site(open, false, 'gh argv array');
    }
  }
  // The shell form: a literal whose body starts `gh `, passed to an exec/spawn callee.
  for (const m of keep.matchAll(/(['"`])gh /g)) {
    const at = m.index;
    const open = enclosingOpen(blank, at);
    if (open < 0) continue;
    const kind = bracketKind(blank, open);
    if (!kind || kind.kind !== 'call' || !/exec|spawn/i.test(kind.callee) || !wholeArg(blank, open, at)) continue;
    site(open, false, 'gh shell-form string');
  }
  sites.sort((a, b) => a.line - b.line);
  return { verdict, sites };
}

// The offenders of a ghSites result: a mis-parse alone, or every site that bypasses the seam.
function offendersOf({ verdict, sites }) {
  if (verdict !== 'ok') return [{ line: 0, text: STRIPPER_VERDICT_MESSAGES[verdict] }];
  return sites.filter((s) => !s.ok).map(({ line, text }) => ({ line, text }));
}

// -> [{ line, text }] for every `gh` site in `raw` that bypasses the seam.
const offendingGhCalls = (raw) => offendersOf(ghSites(raw));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('AC3.1: the matcher flags an unwrapped gh spawn and accepts the wrapped shapes', () => {
  const src = [
    "const { execFileSync } = require('child_process');",
    "execFileSync('gh', ['pr', 'view'], { windowsHide: true });",            // 2: flagged
    "execFileSync('gh', args, ghOptions(args, { windowsHide: true }));",     // ok
    "execFileSyncTimed(",                                                    // 4: flagged (multi-line)
    "  'gh', args, { windowsHide: true });",
    "execBounded(deps, 'gh', args, cwd);",                                   // 6: flagged (non-first position)
    "execBounded(deps, 'gh', args, cwd, ghOptions);",                        // ok
    "const argv = ['gh', 'pr', 'list'];",                                    // 8: flagged (argv array)
    "require('child_process').execSync('gh pr list --json number');",        // 9: flagged (shell form)
    "// execFileSync('gh', ['x'], {}) in a comment",                         // ok
    "stderr('gh pr view failed');",                                          // ok: message, not exec callee
    "if (transport === 'gh') {}",                                            // ok: comparison
  ].join('\n');
  assert.deepEqual(offendingGhCalls(src).map((o) => o.line), [2, 4, 6, 8, 9]);
});

test('the matcher reads literal boundaries, not quote characters inside other literals', () => {
  const src = [
    "const { execFileSync } = require('child_process');",
    "stderr('x.js: `gh` is required, see `gh`, then retry\\n');",           // ok: `gh` inside a message
    "spawnFailed(\"run 'gh', or 'gh pr list'\");",                           // ok: quotes inside a string
    "execFileSync('git', ['config', 'gh']);",                                // ok: a different tool, non-first element
    "const words = new Set(['cat', 'gh', 'jq']);",                           // ok: a non-first array element
    "const v = hosts['gh'];",                                                // ok: member access, not an array
    "execFileSync('gh', args, { windowsHide: true, note: 'ghOptions' });",   // 7: flagged, `ghOptions` only in a string
    "const g = '/*';",
    "execFileSync(\"gh\", ['a'], {});",                                      // 9: flagged after a fake block opener
    "const n = ref.replace(/^origin\\//, ''); execFileSync(`gh`, ['b'], {});", // 10: flagged after a regex ending in \\/
    "execSync(`gh pr view ${n} --json body`);",                              // 11: flagged (template shell form)
    "deps.execFileAsync('gh', a, ghOptions(a, { cwd }));",                   // ok
    "const timedGh = (args) => execFileSyncTimed('gh', args, ghOptions(args, {",
    "  encoding: 'utf8',",
    "}));",                                                                   // ok: multi-line wrapped
    "if ('gh') {}",                                                           // ok: a statement paren, not a call
    "function argv() { return ['gh', 'pr', 'list']; }",                       // 17: flagged (a returned argv)
    "assert.equal('gh' === transport, true);",                                // ok: the literal opens a longer argument
  ].join('\n');
  assert.deepEqual(offendingGhCalls(src).map((o) => o.line), [7, 9, 10, 11, 17]);
});

test('a comment-stripper mis-parse is reported as an offender', () => {
  assert.deepEqual(offendingGhCalls("if (cp) /'/.test(cp); const b = 'p//q'; execFileSync('gh', [b], {});").map((o) => o.line), [0]);
  // Keep mode reads `/'/` as a regex here (ok); blank mode reads its quote as a string
  // opener that swallows the live call (misparsed). The structure text is blank mode's,
  // so that verdict must count too.
  const blankOnly = "if (b) /'/.test(b); const c = 'x'; execFileSync('gh', [c], {});";
  assert.equal(stripperVerdict(blankOnly, stripComments(blankOnly)), 'ok');
  assert.equal(stripperVerdict(blankOnly, stripComments(blankOnly, BLANK)), 'misparsed');
  assert.deepEqual(offendingGhCalls(blankOnly), [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.misparsed }]);
});

// The forge.js allow-list entry holds only while residue.js's runner wraps a `gh` argv
// in ghOptions and probeForge is handed that runner. Read as code, comments blanked.
function residueWrapsGhArgv(raw) {
  const code = stripComments(raw);
  return /\bconst wrap = argv\[0\] === 'gh' \? ghOptions : /.test(code)
    && /\bexecFileSync\(argv\[0\], args, wrap\(args, \{/.test(code)
    && /\bprobeForge\(\{ scope, run, /.test(code);
}

test("the forge.js allow-list reason: residue.js's runner applies ghOptions when argv[0] === 'gh', and probeForge gets that runner", () => {
  const raw = readText(path.join(BIN_ROOT, 'residue.js'));
  assert.equal(stripperVerdict(raw, stripComments(raw)), 'ok');
  assert.ok(residueWrapsGhArgv(raw), "residue.js's runner no longer wraps a gh argv in ghOptions (or probeForge no longer gets it): re-settle forge.js's ALLOWED entry");
  // Go-red: each clause, broken in a copy of the real file, fails the check.
  const mutants = [
    ["argv[0] === 'gh' ? ghOptions", "argv[0] === 'git' ? ghOptions"],
    ['execFileSync(argv[0], args, wrap(args, {', 'execFileSync(argv[0], args, ({'],
    ['probeForge({ scope, run, ', 'probeForge({ scope, run: git, '],
    ["const wrap = argv[0] === 'gh'", "// const wrap = argv[0] === 'gh'"], // the clause inside a comment
  ];
  for (const [from, to] of mutants) {
    assert.ok(raw.includes(from), `mutant anchor missing from residue.js: ${from}`);
    assert.equal(residueWrapsGhArgv(raw.replace(from, to)), false, `mutant still passes: ${to}`);
  }
});

test('AC3.1: every gh spawn under plugin/bin/ routes through ghOptions', () => {
  const files = walk(BIN_ROOT);
  // Fewer files means the walk stopped descending, not that plugin/bin shrank. The floor
  // is the count at landing (#4505); raise it as files are added, never lower it.
  assert.ok(files.length >= 523, `walked only ${files.length} .js files under plugin/bin/ (floor 523): the walk is broken`);
  let matched = 0;
  const offenders = [];
  const allowedSeen = {};
  for (const file of files) {
    const rel = path.relative(BIN_ROOT, file).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    const result = ghSites(readText(file));
    matched += result.sites.length;
    const bad = offendersOf(result);
    if (result.verdict === 'ok' && ALLOWED[rel]) {
      allowedSeen[rel] = bad.length;
      continue;
    }
    for (const o of bad) offenders.push(`${rel}:${o.line}  (${o.text})`);
  }
  // Fewer sites means the matcher stopped matching, not that the gh calls went away. The
  // floor is the count at landing (#4505: 68 wrapped spawns plus the 3 allow-listed
  // literals, repo-resolve.js excluded); raise it as sites are added, never lower it.
  assert.ok(matched >= 71, `matched only ${matched} gh literal sites under plugin/bin/ (floor 71): the matcher stopped matching`);
  for (const [rel, { count }] of Object.entries(ALLOWED)) {
    assert.equal(allowedSeen[rel], count, `${rel}: expected exactly ${count} allow-listed non-spawn gh literal(s), saw ${allowedSeen[rel]} — re-read the line and settle the entry`);
  }
  assert.deepEqual(offenders, [],
    'wrap these gh spawns\' options in repo-resolve.js\'s ghOptions(args, { … }) — without it a GitHub Enterprise origin\'s calls go to github.com');
});

// An explicit --repo pins its own host (repo-resolve.js's pinExplicitRepoHost), and each CLI that
// takes --repo wires that by hand: a `pinGhHost` dep in realDeps plus a `deps.pinGhHost(…)` call in
// run(). The spawn scan above cannot see a CLI that drops either half, and the CLI then splits one
// record across two hosts on a GHE origin (found in #4505's review), so the roster is pinned here.
const PIN_WIRED = ['activity-gather.js', 'fetch-sub-issues.js', 'lib/compose-subject.js', 'lib/number-list-cli.js', 'link-records.js',
  'list-claims.js', 'materialize.js', 'preflight-records.js', 'release-claim.js', 'repair-claim.js', 'resolved-refusal.js'];

test('review (#4505): every CLI that pins its explicit --repo host keeps both halves of the wiring, and no unlisted CLI wires it', () => {
  for (const rel of PIN_WIRED) {
    const code = stripComments(readText(path.join(BIN_ROOT, rel)));
    assert.match(code, /\bpinGhHost:\s*\(repoSpec\)\s*=>\s*pinExplicitRepoHost\(repoSpec\)/, `${rel}: realDeps no longer defines pinGhHost`);
    assert.match(code, /\bdeps\.pinGhHost\(/, `${rel}: run() no longer calls deps.pinGhHost`);
  }
  const wired = walk(BIN_ROOT)
    .filter((file) => /\bpinGhHost\b/.test(stripComments(readText(file))))
    .map((file) => path.relative(BIN_ROOT, file).replace(/\\/g, '/'))
    .sort();
  assert.deepEqual(wired, [...PIN_WIRED].sort(), 'a CLI wires pinGhHost that PIN_WIRED does not list, or one stopped: settle the roster');
});
