'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// #667: no test executes markdown-embedded `node -e` snippets in skills/**/*.md
// (e.g. `skills/capture/SKILL.md`'s born-ready block) — #647's snippet migration was
// verified only by a reviewer's manual read. This is a live-corpus conformance sweep:
// extract every bash-fenced `node -e "..."` / `node -e '...'` block under
// plugin/skills/**/*.md and syntax-check the embedded JS, pinning zero syntax errors.
//
// Reuses tests/sweep-backstop.test.js's extraction idea (regex-match `node -e "..."`,
// unescape the shell-double-quoted body, `node --check` the result) generalized to the
// whole skills corpus: both quote styles, single-line and multi-line forms, scoped to
// ```bash fences only (every occurrence in the corpus lives in one — see the live sweep
// below, which would fail loudly if that ever stopped being true).

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

function findMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Un-escape a bash double-quoted string's own escape set: \\, \$, \`, \" each collapse
// to the literal character; any other backslash is left untouched (bash's own rule for
// what it strips inside "..."). Single quotes need no unescaping — bash allows no
// escapes inside '...' at all, so their body is already the literal JS source text.
function unescapeDoubleQuoted(s) {
  return s.replace(/\\([\\$`"])/g, '$1');
}

// Shared by extractNodeEScripts and extractRawDoubleQuotedNodeEBodies below -- one regex,
// cited by both rather than retyped, per skill-prose-conformance-tests' "import the shipped
// parser's constants" convention.
const DOUBLE_QUOTED_NODE_E_RE = /node -e "((?:\\.|[^"\\])*)"/g;

// Shared by the same two functions, for the same reason. `\r?\n` after the fence opener (not
// a bare `\n`): a checkout with core.autocrlf=true and no .gitattributes (this repo's own
// Windows dev checkouts) normalizes markdown to CRLF, and a literal `\n` here would silently
// match zero fences on such a checkout -- the same class of bug this release already hardened
// elsewhere (extract.js's TAP-frame regex, #2033).
const BASH_FENCE_RE = /```bash\r?\n([\s\S]*?)```/g;

// Extract every `node -e "..."` / `node -e '...'` invocation from within ```bash fences.
// Handles both quote styles and both single-line and multi-line forms with one regex
// per style (character classes match newlines by default, so no /s flag is needed).
function extractNodeEScripts(markdown) {
  const scripts = [];
  const fenceRe = new RegExp(BASH_FENCE_RE.source, 'g');
  let fence;
  while ((fence = fenceRe.exec(markdown)) !== null) {
    const block = fence[1];
    const doubleQuoted = new RegExp(DOUBLE_QUOTED_NODE_E_RE.source, 'g');
    let m;
    while ((m = doubleQuoted.exec(block)) !== null) scripts.push(unescapeDoubleQuoted(m[1]));
    const singleQuoted = /node -e '([^']*)'/g;
    while ((m = singleQuoted.exec(block)) !== null) scripts.push(m[1]);
  }
  return scripts;
}

// Extract every double-quoted node -e body's RAW (pre-unescape) text. Double-quoted only,
// deliberately: a single-quoted node -e body is already immune to this hazard (bash performs
// zero substitution inside '...'), so it needs no check here.
function extractRawDoubleQuotedNodeEBodies(markdown) {
  const bodies = [];
  const fenceRe = new RegExp(BASH_FENCE_RE.source, 'g');
  let fence;
  while ((fence = fenceRe.exec(markdown)) !== null) {
    const block = fence[1];
    const doubleQuoted = new RegExp(DOUBLE_QUOTED_NODE_E_RE.source, 'g');
    let m;
    while ((m = doubleQuoted.exec(block)) !== null) bodies.push(m[1]);
  }
  return bodies;
}

// A bare backtick inside a double-quoted node -e body is bash command substitution, not JS
// syntax (#1964) -- a JS comment like `// ...deprecated `next` alias` reads as ordinary prose
// to a human, but bash parses the whole node -e "..." string before node ever sees it, so the
// unescaped backtick pair triggers `next` as a command substitution (observed live as a
// "next: command not found" stderr line on every run). `node --check` above never catches this
// -- after unescaping, the JS itself is syntactically valid; only a dedicated shell-level sweep
// does. Escaped backticks (`\``) are excluded -- bash's own escape rule (unescapeDoubleQuoted
// above) means those are genuinely inert, literal characters once bash finishes parsing.
function findBareBackticks(rawBody) {
  const sites = [];
  const re = /\\.|`/g;
  let m;
  while ((m = re.exec(rawBody)) !== null) {
    if (m[0] === '`') sites.push(m.index);
  }
  return sites;
}

// A handful of these snippets embed bash-side substitution the surrounding skill's own
// shell context resolves before node ever sees the text — a JSON blob spliced in via
// `${LABELS_JSON}`, a `$(...)` command substitution, or (rarely) a bare `/* elided */;`
// documentation placeholder standing in for a value spelled out elsewhere in the same
// skill file. None of these are runtime concerns for a syntax-only check (`node --check`
// never executes the body), but the *literal* text isn't valid JS on its own — swap in a
// syntactically inert placeholder so the check still proves the surrounding JS structure
// is well-formed. This mirrors the Gotchas' `process.argv` placeholder-substitution
// guidance, generalized to the other elision idioms actually present in the corpus.
// Deliberately narrow: `${IDENTIFIER}` only matches simple bare bash variable names
// (letters/digits/underscore, no `.`/`[`), so it never touches a genuine JS
// template-literal expression like `${process.argv[1]}` — those already parse as valid
// JS and need no substitution.
function substituteShellPlaceholders(script) {
  let out = script;
  out = out.replace(/=\s*\/\*[\s\S]*?\*\/\s*;/g, '= null;');
  out = out.replace(/\$\([^()]*\)/g, 'null');
  out = out.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'null');
  return out;
}

function checkSyntax(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-node-e-syntax-'));
  const file = path.join(dir, 'snippet.js');
  fs.writeFileSync(file, substituteShellPlaceholders(script));
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.stderr ? err.stderr.toString() : String(err) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Proof the check can go red (synthetic fixtures, per skill-prose-conformance-tests'
// go-red guidance — a check that can never fail proves nothing) ---

test('extractNodeEScripts: finds a double-quoted multi-line node -e block inside a bash fence', () => {
  const md = [
    '```bash',
    'node -e "',
    '  console.log(1)',
    '"',
    '```',
  ].join('\n');
  const scripts = extractNodeEScripts(md);
  assert.strictEqual(scripts.length, 1);
  assert.match(scripts[0], /console\.log\(1\)/);
});

test('extractNodeEScripts: finds a single-quoted single-line node -e block', () => {
  const md = '```bash\nVERDICT=$(node -e \'console.log("hi")\')\n```';
  const scripts = extractNodeEScripts(md);
  assert.strictEqual(scripts.length, 1);
  assert.match(scripts[0], /console\.log\("hi"\)/);
});

test('extractNodeEScripts: ignores node -e text outside a ```bash fence', () => {
  const md = 'Some prose mentioning `node -e "console.log(1)"` inline, not fenced.';
  assert.deepStrictEqual(extractNodeEScripts(md), []);
});

test('unescapeDoubleQuoted: collapses \\", \\$, \\\\, and \\` but leaves other backslashes untouched', () => {
  assert.strictEqual(unescapeDoubleQuoted('say \\"hi\\"'), 'say "hi"');
  assert.strictEqual(unescapeDoubleQuoted('\\${process.argv[1]}'), '${process.argv[1]}');
  assert.strictEqual(unescapeDoubleQuoted('a\\\\b'), 'a\\b');
  assert.strictEqual(unescapeDoubleQuoted('\\n'), '\\n');
});

test('checkSyntax: a syntactically invalid snippet is caught (planted fixture)', () => {
  const result = checkSyntax('const x = ;');
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /SyntaxError/);
});

test('checkSyntax: negative control — the same shape with a valid expression passes', () => {
  const result = checkSyntax('const x = 1;');
  assert.strictEqual(result.ok, true);
});

test('checkSyntax: a valid snippet using process.argv (no substitution needed) passes', () => {
  const result = checkSyntax('console.log(process.argv[1]);');
  assert.strictEqual(result.ok, true);
});

test('substituteShellPlaceholders: neutralizes a bash ${VAR} splice into a valid placeholder', () => {
  const result = checkSyntax('const labels = ${LABELS_JSON};');
  assert.strictEqual(result.ok, true);
});

test('substituteShellPlaceholders: neutralizes a $(...) command substitution', () => {
  const result = checkSyntax('const enabled = $(echo true);');
  assert.strictEqual(result.ok, true);
});

test('substituteShellPlaceholders: neutralizes an elided-value doc comment used as an expression', () => {
  const result = checkSyntax('const keyFiles = /* parsed elsewhere */;');
  assert.strictEqual(result.ok, true);
});

test('substituteShellPlaceholders: never touches a JS template-literal expression', () => {
  const result = checkSyntax('console.log(`id: ${process.argv[1]}`);');
  assert.strictEqual(result.ok, true);
});

test('extractRawDoubleQuotedNodeEBodies: extracts the raw (pre-unescape) double-quoted body', () => {
  const md = [
    '```bash',
    'node -e "',
    '  // deprecated `next` alias',
    '  console.log(1)',
    '"',
    '```',
  ].join('\n');
  const bodies = extractRawDoubleQuotedNodeEBodies(md);
  assert.strictEqual(bodies.length, 1);
  assert.match(bodies[0], /deprecated `next` alias/);
});

test('findBareBackticks: flags an unescaped backtick pair (#1964 planted fixture)', () => {
  const sites = findBareBackticks("  // the drain's deprecated `next` alias\n  console.log(1)");
  assert.strictEqual(sites.length, 2, 'must flag both backticks around `next`');
});

test('findBareBackticks: does not flag an escaped backtick', () => {
  const sites = findBareBackticks('console.log(\\`hi\\`)');
  assert.deepStrictEqual(sites, []);
});

test('findBareBackticks: negative control — a body with no backtick at all', () => {
  const sites = findBareBackticks('console.log(1)');
  assert.deepStrictEqual(sites, []);
});

// --- Live-corpus sweep ---

test('every node -e script embedded in a plugin/skills/**/*.md bash fence is syntactically valid', () => {
  const files = findMarkdownFiles(SKILLS_DIR);
  assert.ok(files.length > 0, 'sanity: the skills sweep must find files to check');

  let scriptCount = 0;
  const failures = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const scripts = extractNodeEScripts(markdown);
    scriptCount += scripts.length;
    for (const [index, script] of scripts.entries()) {
      const result = checkSyntax(script);
      if (!result.ok) {
        failures.push(`${path.relative(ROOT, file)} (snippet #${index}): ${result.message.split('\n')[0]}`);
      }
    }
  }

  assert.ok(scriptCount > 0, 'sanity: the skills sweep must find at least one node -e snippet');
  assert.deepStrictEqual(failures, [], `node -e syntax error(s):\n${failures.join('\n')}`);
});

// #1964: a backtick inside a double-quoted node -e body's JS comment reads as ordinary prose
// but is command-substituted by bash before node ever runs, printing a spurious
// "{token}: command not found" line to stderr on every invocation (observed live in
// dispatch/queue-pull-script.md). node --check can't catch this -- the JS is syntactically
// valid either way -- so this is a dedicated shell-level sweep, not a syntax check.
test('no double-quoted node -e body in plugin/skills/**/*.md contains a bare backtick', () => {
  const files = findMarkdownFiles(SKILLS_DIR);
  assert.ok(files.length > 0, 'sanity: the skills sweep must find files to check');

  let bodyCount = 0;
  const failures = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const bodies = extractRawDoubleQuotedNodeEBodies(markdown);
    bodyCount += bodies.length;
    for (const [index, body] of bodies.entries()) {
      const sites = findBareBackticks(body);
      if (sites.length > 0) {
        failures.push(`${path.relative(ROOT, file)} (double-quoted node -e body #${index}): ${sites.length} bare backtick(s)`);
      }
    }
  }

  assert.ok(bodyCount > 0, 'sanity: the skills sweep must find at least one double-quoted node -e body');
  assert.deepStrictEqual(failures, [], `bare backtick(s) inside a double-quoted node -e body -- bash command-substitutes these before node runs:\n${failures.join('\n')}`);
});
