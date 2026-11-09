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

// `raw` stripped in both modes, and the first non-ok stripperVerdict of the two texts.
function stripBoth(raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, BLANK);
  const verdict = [keep, blank].map((text) => stripperVerdict(raw, text)).find((v) => v !== 'ok') || 'ok';
  return { keep, blank, verdict };
}

// -> { verdict, sites: [{ line, text, ok }] } for every `gh` literal site in `raw`.
function ghSites(raw) {
  const { keep, blank, verdict } = stripBoth(raw);
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

// An explicit --repo records its host through repo-resolve.js's pinExplicitRepoHost, which ghOptions
// adds to every later gh call's own env (process.env is never written). Each CLI that takes --repo
// wires that by hand: a `pinGhHost` dep in realDeps plus a `deps.pinGhHost(…)` call in run(). A
// caller scoping the host to some calls passes ghOptions's `deps.explicitHost` instead
// (backlog-grant-gate.js). The spawn scan above cannot see a CLI that drops either half, and the CLI
// then splits one record across two hosts on a GHE origin (found in #4505's review), so the roster
// is pinned here.
const PIN_WIRED = ['acceptance-packet.js', 'activity-gather.js', 'fetch-sub-issues.js', 'lib/compose-subject.js', 'lib/number-list-cli.js', 'link-records.js',
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

// #4795: an explicit --repo's host reaches gh one way only — ghOptions adds it to a
// call's own env (repo-resolve.js). A file that builds `GH_HOST: …` into an env or
// assigns `….GH_HOST = …` has grown a second mechanism. Blank mode, so a GH_HOST
// named in a message string or comment is not code. Matched: `GH_HOST: h`,
// `GH_HOST = h`, a logical assignment (`||=`, `??=`, `&&=`), and the object shorthand
// (`{ ...process.env, GH_HOST }`: GH_HOST following `{` or `,` and followed by `,` or
// `}`, so `f(e.GH_HOST, x)` is a read and stays unflagged).
//
// Recall limits: a quoted or computed key (`{ "GH_HOST": h }`, `env["GH_HOST"] = h`) is
// not seen, since blank mode empties string contents; nor is
// `Object.defineProperty(env, "GH_HOST", …)`.
const GH_HOST_BUILD = /\bGH_HOST\s*:(?!:)|\bGH_HOST\s*=(?!=)|\bGH_HOST\s*(?:\|\||\?\?|&&)=|(?:^|[{,])\s*GH_HOST\s*[,}]/;
function ghHostBuilders(raw) {
  const blank = stripComments(raw, BLANK);
  const verdict = stripperVerdict(raw, blank);
  if (verdict !== 'ok') return [STRIPPER_VERDICT_MESSAGES[verdict]];
  return blank.split('\n').map((l, i) => (GH_HOST_BUILD.test(l) ? `line ${i + 1}` : null)).filter(Boolean);
}
test('#4795: the matcher flags an env built or assigned with GH_HOST, and not a read or a message', () => {
  assert.equal(ghHostBuilders('const e = { ...process.env, GH_HOST: h };').length, 1);
  assert.equal(ghHostBuilders('process.env.GH_HOST = h;').length, 1);
  assert.equal(ghHostBuilders("const { GH_HOST: _p, ...env } = process.env;").length, 1);
  assert.equal(ghHostBuilders('const e = { ...process.env, GH_HOST };').length, 1); // object shorthand
  assert.equal(ghHostBuilders('env.GH_HOST ||= h;').length, 1); // logical assignment
  assert.equal(ghHostBuilders('env.GH_HOST ??= h;').length, 1);
  assert.equal(ghHostBuilders('env.GH_HOST &&= h;').length, 1);
  assert.deepEqual(ghHostBuilders("if ('GH_HOST' in base) x(); if (e.GH_HOST === h) y(); const m = 'GH_HOST: set';"), []);
  assert.deepEqual(ghHostBuilders('f(e.GH_HOST, x); g({ a: e.GH_HOST }); if (e.GH_HOST || h) y();'), []);
  // a comment-stripper mis-parse is reported as an offender, never read as clean (the same
  // source the spawn scan's mis-parse test uses: blank mode reads `/'/` as a string opener)
  assert.deepEqual(ghHostBuilders("if (b) /'/.test(b); const c = 'x'; process.env.GH_HOST = c;"), [STRIPPER_VERDICT_MESSAGES.misparsed]);
});
test('AC3.1 (#4795): no file under plugin/bin but repo-resolve.js builds or assigns GH_HOST', () => {
  const offenders = [];
  for (const file of walk(BIN_ROOT)) {
    const rel = path.relative(BIN_ROOT, file).replace(/\\/g, '/');
    if (rel === 'lib/repo-resolve.js') continue;
    for (const where of ghHostBuilders(readText(file))) offenders.push(`${rel}: ${where}`);
  }
  assert.deepEqual(offenders, [], 'route the host through ghOptions (an explicit --repo: pinExplicitRepoHost, or deps.explicitHost for one call) instead of building GH_HOST by hand');
});

// #4933: a CLI's origin-derived repo goes through repo-resolve.js's gateOriginRepo(remote, deps),
// which refuses an origin host with no positive GitHub signal before any gh call. A fresh
// `parseRepo(<origin>)` hands gh a spec for whatever host the remote names, so this scan flags one
// outside NOT_ORIGIN.
//
// A site is a `parseRepo(` or `originSpecOf(` call (#4794's one origin read, which wraps parseRepo),
// bare or member (`deps.parseRepo(`), whose balanced argument text matches ORIGIN_ARG. A
// `function originSpecOf(` definition is no call. Blank-mode text locates the call and its argument
// boundaries: a `parseRepo(` in a string or comment is blanked there, and a paren inside a literal moves no boundary.
// Keep-mode text over the same span supplies the argument's literals (`'get-url'`, `'origin'`). An
// explicit --repo parse (`parseRepo(opts.repo.split('/')…)`) names none of the tokens and is no site.
//
// Recall limits: only the argument's own text is read. A local assigned from `remoteUrl()` or
// `get-url` under another name and parsed on a later line (`url = deps.remoteUrl(); …
// originSpecOf(url)`, activity-gather.js's shape) is not a site; that two-line shape is an accepted
// gap. Nor is a parse reached through an alias (`const p = parseRepo; p(remote)`). Nor is a
// single-expression origin read whose argument avoids the tokens by its naming alone
// (`parseRepo(remoteOut)`, `parseRepo(originUrl)`, `parseRepo(remoteURL())`): recall rests on
// the argument being named `remote`, `remoteUrl`, or a `get-url`/`'origin'` literal.
const ORIGIN_ARG = /\bremote\b|remoteUrl|get-url|['"]origin['"]/;

// -> { verdict, sites: [{ line, text }] } for every origin-reading parseRepo call in `raw`.
function originReads(raw) {
  const { keep, blank, verdict } = stripBoth(raw);
  const sites = [];
  for (const m of blank.matchAll(/(?<![\w$])(?:parseRepo|originSpecOf)\s*\(/g)) {
    if (/\bfunction\s+$/.test(blank.slice(Math.max(0, m.index - 40), m.index))) continue; // a definition, not a call
    const open = m.index + m[0].length - 1;
    const end = open + 1 + balanced(blank, open).length;
    if (!ORIGIN_ARG.test(keep.slice(open + 1, end))) continue;
    const text = keep.slice(m.index, end + 1).replace(/\s+/g, ' ').slice(0, 100);
    sites.push({ line: lineOf(blank, m.index), text: `origin read without gateOriginRepo: ${text}` });
  }
  return { verdict, sites };
}

// Files that may read the origin through parseRepo, keyed file -> exact site count. Each count
// was settled by reading the lines. activity-gather.js is not listed: it reads the origin in two
// lines (the recall gap above; `originSpecOf(url)`), so it has 0 sites, and it stops on
// any host but github.com anyway.
const NOT_ORIGIN = {
  'lib/repo-resolve.js': { count: 2, reason: "defines the gate: originSpecOf's own `parseRepo(hostPathOf(remote))` is the one parse, and gateOriginRepo's `originSpecOf(remote)` is the one origin read the gate judges. resolveGhSpec's `originSpecOf(url)` names no token and is unmatched; harmless, since this file is the seam" },
  'parent-gate.js': { count: 1, reason: "decided by the user at #4933's plan review: the --facts-json path makes no gh call and keeps an ungated `originSpecOf(remote)` (the seam's normalized read, #4794), only to judge a qualified --closing token; its gh path calls the gate (ORIGIN_GATED)" },
  'lib/wrap-up/engine-verify.js': { count: 2, reason: "carrier-commit's and reference-repairs' `parseRepo(<origin>)` pass only owner/repo to deps.gh, a ghOptions-wrapped runner, so the host is the seam's choice, never the parsed one. The acceptance-labeling check's origin goes through the gate (resolveCheckRepo, #4805), which ORIGIN_GATED lists" },
  'lib/reconcile/pr-state-batch.js': { count: 1, reason: "githubOrigin keeps the parse only when its host is github.com, and the batch query pins `--hostname github.com`" },
};

// The files whose code calls gateOriginRepo(, the defining lib/repo-resolve.js excluded.
const ORIGIN_GATED = ['materialize.js', 'lib/compose-subject.js', 'release-claim.js', 'repair-claim.js', 'preflight-records.js',
  'parent-gate.js', 'resolved-refusal.js', 'link-records.js', 'fetch-sub-issues.js', 'backlog-grant-gate.js',
  'apply-refine-labels.js', 'file-feedback.js', 'list-claims.js', 'lib/number-list-cli.js', 'lib/wrap-up/pack.js', 'lib/wrap-up/engine-verify.js', 'lib/hooks/git-exec.js', 'stuck-open-prs.js', 'claim-targets.js', 'stale-claim-pr.js'];

// A gateOriginRepo( call in code; blank mode leaves a name inside a string or comment unseen.
const callsGate = (raw) => /(?<![\w$])gateOriginRepo\s*\(/.test(stripComments(raw, BLANK));

test('AC9.1: the origin-read matcher flags a fresh parseRepo(remote) and ignores explicit --repo parsing', () => {
  const src = [
    "const { parseRepo } = require('./lib/repo-resolve');",
    'parseRepo(remote);',                                                            // 2: flagged
    'deps.parseRepo(remote);',                                                       // 3: flagged (member)
    "parseRepo(git(['remote', 'get-url', 'origin']));",                              // 4: flagged (get-url literal)
    'parseRepo(opts.repo ? x : remote);',                                            // 5: flagged (origin in one arm)
    "parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`);", // ok: explicit --repo
    '// parseRepo(remote)',                                                          // ok: comment
    "const s = 'parseRepo(remote)';",                                                // ok: string
    'parseRepo(view && view.url);',                                                  // ok: no origin token
    'const spec = parseRepo(',                                                       // 10: flagged (multi-line)
    '  remoteUrl());',
    "parseRepo(x || ')', remote);",                                                  // 12: flagged, a paren in a literal moves no boundary
    'parseRepo(url); remote();',                                                     // ok: the token is past the call
    'const r = gateOriginRepo(remote, deps.gateDeps);',                              // ok: the gate
    'const o = originSpecOf(remote);',                                               // 15: flagged (#4794's wrapper of parseRepo)
    'function originSpecOf(remote) {}',                                              // ok: a definition, not a call
    'const m = deps.originSpecOf(remoteUrl());',                                     // 17: flagged (member)
    'const u = originSpecOf(url);',                                                  // ok: no origin token
  ].join('\n');
  assert.deepEqual(offendersOf(originReads(src)).map((o) => o.line), [2, 3, 4, 5, 10, 12, 15, 17]);
  // A mis-parse is an offender: both modes mis-parse the first line, only blank mode the second.
  assert.deepEqual(offendersOf(originReads("if (cp) /'/.test(cp); const b = 'p//q'; parseRepo(remote);")),
    [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.misparsed }]);
  assert.deepEqual(offendersOf(originReads("if (b) /'/.test(b); const c = 'x'; parseRepo(remote);")),
    [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.misparsed }]);
});

test('AC9.1 go-red: materialize.js with its gate call swapped for parseRepo(remote) is flagged', () => {
  const raw = readText(path.join(BIN_ROOT, 'materialize.js'));
  const from = 'gateOriginRepo(remote, deps.gateDeps)';
  assert.ok(raw.includes(from), `mutant anchor missing from materialize.js: ${from}`);
  assert.deepEqual(offendersOf(originReads(raw)), []);
  const mutant = raw.replace(from, 'parseRepo(remote)');
  assert.deepEqual(offendersOf(originReads(mutant)).map((o) => o.line), [lineOf(raw, raw.indexOf(from))]);
  assert.equal(callsGate(mutant), false);
});

test('AC9.2: no plugin/bin file reads the origin through parseRepo outside NOT_ORIGIN', () => {
  const files = walk(BIN_ROOT);
  assert.ok(files.length >= 523, `walked only ${files.length} .js files under plugin/bin/ (floor 523): the walk is broken`);
  let matched = 0;
  const offenders = [];
  const seen = {};
  for (const file of files) {
    const rel = path.relative(BIN_ROOT, file).replace(/\\/g, '/');
    const result = originReads(readText(file));
    matched += result.sites.length;
    const bad = offendersOf(result);
    if (result.verdict === 'ok' && NOT_ORIGIN[rel]) {
      seen[rel] = bad.length;
      continue;
    }
    for (const o of bad) offenders.push(`${rel}:${o.line}  (${o.text})`);
  }
  // Fewer sites means the matcher stopped matching, not that the origin reads went away. The
  // floor is the NOT_ORIGIN site total: #4933 set it at 9, and #4951 moved stuck-open-prs.js's one
  // site onto the gate (a deliberate removal, not lost recall), so it is 8; #4805 moved engine-verify.js's
  // acceptance-labeling reads (two sites) onto the gate the same way, so it is 6. #4794 moved stale-claim-pr.js's
  // one site onto the gate (its origin now goes through gateOriginRepo, a deliberate removal), so it is 5.
  // Raise it as sites are added, never lower it otherwise.
  assert.ok(matched >= 5, `matched only ${matched} origin-reading parseRepo sites under plugin/bin/ (floor 5): the matcher stopped matching`);
  for (const [rel, { count }] of Object.entries(NOT_ORIGIN)) {
    assert.equal(seen[rel], count, `${rel}: expected exactly ${count} origin-reading parseRepo site(s), saw ${seen[rel]} — re-read the lines and settle the entry`);
  }
  assert.deepEqual(offenders, [],
    'route these origin reads through repo-resolve.js\'s gateOriginRepo(remote, deps) — a raw parseRepo sends an unknown origin host\'s calls to gh');
});

test('AC9.3: ORIGIN_GATED is exactly the set of files calling gateOriginRepo', () => {
  for (const rel of ORIGIN_GATED) {
    assert.ok(callsGate(readText(path.join(BIN_ROOT, rel))), `${rel}: no longer calls gateOriginRepo(`);
  }
  const gated = walk(BIN_ROOT)
    .map((file) => path.relative(BIN_ROOT, file).replace(/\\/g, '/'))
    .filter((rel) => rel !== 'lib/repo-resolve.js' && callsGate(readText(path.join(BIN_ROOT, rel))))
    .sort();
  assert.deepEqual(gated, [...ORIGIN_GATED].sort(), 'a file calls gateOriginRepo that ORIGIN_GATED does not list, or one stopped: settle the roster');
});

// #4794: repoSlugOf (the host-less origin slug) is retired; every origin slug goes through the gate
// (git-exec.js's repoTargetOf). Blank mode leaves a name in a string or comment unseen, and a
// stripper mis-parse is an offender, never a clean read.
const REPO_SLUG_OF = /(?<![\w$])repoSlugOf(?![\w$])/;
function repoSlugOfNames(raw) {
  const blank = stripComments(raw, BLANK);
  const verdict = stripperVerdict(raw, blank);
  if (verdict !== 'ok') return [STRIPPER_VERDICT_MESSAGES[verdict]];
  return blank.split('\n').map((l, i) => (REPO_SLUG_OF.test(l) ? `line ${i + 1}` : null)).filter(Boolean);
}
test('#4794: the repoSlugOf matcher flags a code mention, and not a comment, a string or a longer name', () => {
  assert.equal(repoSlugOfNames("const { repoSlugOf } = require('./git-exec');").length, 1);
  assert.equal(repoSlugOfNames('const slug = repoSlugOf(repoRoot);').length, 1);
  assert.equal(repoSlugOfNames('module.exports = { repoSlugOf, repoSpecOf };').length, 1);
  assert.deepEqual(repoSlugOfNames("// repoSlugOf is retired\nconst s = 'repoSlugOf'; /* repoSlugOf */ const a = myrepoSlugOf + repoSlugOfX + $repoSlugOf;"), []);
  assert.deepEqual(repoSlugOfNames("if (b) /'/.test(b); const c = 'x'; repoSlugOf(c);"), [STRIPPER_VERDICT_MESSAGES.misparsed]);
});
test('#4794: no plugin/bin file names repoSlugOf — origin slugs go through the gate (repoTargetOf)', () => {
  const files = walk(BIN_ROOT);
  assert.ok(files.length >= 523, `walked only ${files.length} .js files under plugin/bin/ (floor 523): the walk is broken`);
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(BIN_ROOT, file).replace(/\\/g, '/');
    for (const where of repoSlugOfNames(readText(file))) offenders.push(`${rel}: ${where}`);
  }
  assert.deepEqual(offenders, [], 'repoSlugOf dropped the origin host; resolve the origin through git-exec.js\'s repoTargetOf (slug, ghRepo, host) so the #4933 gate decides the host');
});
