'use strict';

// The repo-local guard against direct `node --test` runs (#5547): a multi-file or looped direct run skips
// what tools/run-tests.js gives a run (SAFEGUARDS_TEXT), so a typed Bash command holding one is denied with
// the runner command that runs the same files. This file holds four things: the classifier
// (`classifyCommand` decides a typed command; `hasDirectTestRun` says whether any segment of a text is a
// direct test run at all, a single-file one included), the script scan (`judge` also reads the script file
// a Bash call runs, since a scratch script can start `node --test` itself; `scanScript` reads one text), the
// real file-system dependencies (`realDeps`), and the PreToolUse hook entry (`main`, run when the file is
// the process entry). The classifier and scan take every file-system answer through `hasRunner`,
// `isDirectory` and `readScript`; OS path rules come from `pathImpl`. Segments, effective cwds and
// assignment substitution come from the hooks' shared shell scanner (forEachCommandSegment), so quoted text
// (`echo "node --test a b"`) is one word and never a command.

// The hook must never exit non-zero or print on a fault, a failed require below included: as the process
// entry, an uncaught error is swallowed (stdout stays empty, the status stays 0).
if (require.main === module) process.on('uncaughtException', () => {});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { forEachCommandSegment } = require('../plugin/bin/lib/hooks/git-command');

const SAFEGUARDS_TEXT = 'A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.';
const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';
const LOOP_FILES_PLACEHOLDER = '<the test files this loop runs>';
// The line printed when no command can be pasted, with one of the notes below directly under it.
const REFUSED_PLACEHOLDER = 'node <path to tools/run-tests.js> <the test files, as *.test.js paths inside that checkout>';
const MANY_CHECKOUTS_LINE = "The files sit in more than one checkout; run each checkout's files through its own tools/run-tests.js.";
const CUT_SUBSTITUTION_LINE = 'The command substitution could not be read whole; put the same substitution after the runner path.';
const RELATIVE_VALUE_LINE = 'The runner starts node from the checkout root, so a relative path inside a flag value is read from there.';
// The test flags whose value is a path.
const PATH_VALUE_FLAGS = new Set(['--test-reporter-destination', '--test-coverage-include', '--test-coverage-exclude', '--test-global-setup']);

// tools/run-tests.js, read lazily: it pulls in child_process and the suite-slot modules, which a Bash call
// with no node program never needs (the hook runs on every call).
const runner = () => require('./run-tests');
let testValueCache = null;
// The runner's test flags that take a value word.
function nodeTestValueSet() {
  if (testValueCache === null) testValueCache = new Set(runner().NODE_TEST_VALUE_FLAGS);
  return testValueCache;
}
// General node options (not test flags) that take their value as the next word: every option `node --help`
// (Node 26.13.1) prints as `--name=...`, with its short and alias spellings. A value is never counted as a
// file. The runner takes none of them, so the replacement line leaves them out and the reason names them.
const NODE_VALUE_OPTIONS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists', '-C',
  '--conditions', '--input-type', '--title', '--watch-path', '--inspect-port', '--debug-port', '--disable-warning',
  '--redirect-warnings', '--diagnostic-dir', '--max-http-header-size', '--secure-heap', '--secure-heap-min',
  '--allow-fs-read', '--allow-fs-write', '--bench-isolation', '--bench-name-pattern', '--bench-reporter',
  '--bench-reporter-destination', '--bench-samples', '--bench-warmup', '--build-sea', '--build-snapshot-config',
  '--cpu-prof-dir', '--cpu-prof-interval', '--cpu-prof-name', '--disable-proto', '--dns-result-order',
  '--experimental-package-map', '--experimental-sea-config', '--heap-prof-dir', '--heap-prof-interval',
  '--heap-prof-name', '--heapsnapshot-near-heap-limit', '--heapsnapshot-signal', '--icu-data-dir',
  '--inspect-publish-uid', '--localstorage-file', '--max-old-space-size-percentage',
  '--network-family-autoselection-attempt-timeout', '--openssl-config', '--process-timeout', '--report-filename',
  '--report-signal', '--run', '--snapshot-blob', '--tls-cipher-list', '--tls-keylog', '--trace-event-categories',
  '--trace-event-file-pattern', '--trace-require-module', '--unhandled-rejections', '--use-largepages',
  '--v8-pool-size', '--vfs-load', '--watch-kill-signal',
]);
// Options whose value is inline code: a node command using one runs no script file.
const INLINE_CODE_OPTIONS = new Set(['-e', '--eval', '-p', '--print']);
const NPX_VALUE_OPTIONS = new Set(['-p', '--package']);
// Keywords a command can follow in its segment. A `while`/`until` one also opens a loop whose condition
// is this segment, so a run there is repeated.
const LEAD_KEYWORDS = new Set(['do', 'then', 'else', 'if', 'elif', 'while', 'until']);
const CONDITION_LOOPS = new Set(['while', 'until']);
// The leads that run their command once per input, each with its options that take a value word.
const REPEATING_LEADS = new Map([
  ['xargs', new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '-J', '-R', '-S', '--arg-file', '--delimiter',
    '--max-args', '--max-lines', '--max-procs', '--max-chars', '--eof', '--process-slot-var'])],
  ['parallel', new Set(['-j', '-n', '-N', '-I', '-S', '-a', '-d', '-E', '-L', '-P', '--jobs', '--max-args',
    '--arg-file', '--delimiter', '--sshlogin'])],
]);
const FIND_EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const NODE_NAMES = new Set(['node', 'node.exe']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
const DIR_STACK_COMMANDS = new Set(['pushd', 'popd']);
const MAX_WRAPPER_DEPTH = 3;

// The options each transparent prefix command is read with: `flags` (one word each), `valued` (the option
// and the next word), `assignments` (`NAME=value` words count as options), `duration` (one more word after
// the options). Any other option ends the prefix's options, so that option word is taken as the program:
// it is never node, so the segment is allowed, as a prefix that is not modeled should be.
const TIMEOUT_OPTIONS = {
  flags: /^(?:-[vfp]|--verbose|--foreground|--preserve-status|-[sk].+|--signal=.+|--kill-after=.+)$/,
  valued: new Set(['-s', '-k', '--signal', '--kill-after']),
  duration: true,
};
const PREFIX_OPTIONS = new Map([
  ['env', { flags: /^(?:-i|--ignore-environment|-|-u.+|--unset=.+)$/, valued: new Set(['-u', '--unset']), assignments: true }],
  ['time', { flags: /^-p$/ }],
  ['nice', { flags: /^(?:-n?-?[0-9]+|--adjustment=.+)$/, valued: new Set(['-n', '--adjustment']) }],
  ['nohup', {}],
  ['command', { flags: /^-p$/ }],
  ['exec', { flags: /^-[cl]+$/, valued: new Set(['-a']) }],
  ['timeout', TIMEOUT_OPTIONS],
  ['gtimeout', TIMEOUT_OPTIONS],
  ['sudo', { flags: /^-[EnH]+$/, valued: new Set(['-u']) }],
]);
// Every word the classifier or the script scan reads at a program position: the node names and npx, the
// shells and `eval` (whose text is walked), `source` and `.`, and the words that move the program further
// along a segment (LEAD_KEYWORDS, PREFIX_OPTIONS, REPEATING_LEADS, find). tools/direct-test-run-guard.sh
// sends a call to node when any fragment of the command starts with one of them, and a test pins its list
// to this one. npx, eval, source, `.` and find are compared inline below: a rule keyed on a new first word
// adds the word here, and the test that runs every denied command through the prefilter fails until it does.
const PROGRAM_WORDS = Object.freeze([...new Set([
  ...NODE_NAMES, 'npx', ...SHELLS, 'eval', 'source', '.', ...LEAD_KEYWORDS, ...PREFIX_OPTIONS.keys(), ...REPEATING_LEADS.keys(), 'find',
])]);

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GLOB_RE = /[*?[{]/;
const EXPANSION_RE = /[$`]/;
const LOOP_VAR_RE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
const VAR_REF_RE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
// A redirection word: an operator alone (its target is the next word) or glued to its target (`>out`, `2>&1`).
const REDIRECT_RE = /^(?:[0-9]*|&)[<>]/;
const REDIRECT_OP_RE = /^(?:[0-9]*|&)(?:>>?|>\||<<?<?|<>|>&|<&)$/;
// A shell's short-option cluster (`-c`, `-lc`, `-euo`, `+o`). One starting `-` and holding `c` makes the
// shell run its first non-option word as a script; each `o` or `O` in it takes one following word (an
// option name).
const SHELL_CLUSTER_RE = /^[-+][A-Za-z]+$/;
const optionValueCount = (cluster) => (cluster.match(/[oO]/g) || []).length;

const ALLOW = () => ({ decision: 'allow' });

// The word as the shell would read it back: each span re-quoted the way it was typed (`spanKinds`, one
// character per value character: `b` bare, `e` backslash-escaped, `s` single-, `d` double-quoted).
function requote(value, kinds) {
  if (typeof kinds !== 'string' || kinds.length !== value.length) return value;
  if (value === '') return '""';
  let out = '';
  for (let i = 0; i < value.length;) {
    let j = i;
    while (j < value.length && kinds[j] === kinds[i]) j += 1;
    const run = value.slice(i, j);
    if (kinds[i] === 's') out += `'${run}'`;
    else if (kinds[i] === 'd') out += `"${run}"`;
    else if (kinds[i] === 'e') out += run.replace(/[\s\S]/g, '\\$&');
    else out += run;
    i = j;
  }
  return out;
}

// A word whose value the scanner substituted from an earlier `NAME=value`: the value, double-quoted when
// the original was quoted or the value holds a blank.
function quoteValue(value, kinds) {
  if ((typeof kinds === 'string' && /[^b]/.test(kinds)) || /\s/.test(value) || value === '') {
    return `"${value.replace(/["\\$`]/g, '\\$&')}"`;
  }
  return value;
}

function isUnder(p, dir, P) {
  const rel = P.relative(dir, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel));
}

const toSlash = (p, P) => p.split(P.sep).join('/');

// One segment as the scanner handed it, with the helpers every rule reads it through.
function segmentView(t, q, P) {
  const raw = Array.isArray(q && q.raw) ? q.raw : t;
  const kinds = (q && q.spanKinds) || [];
  const bare = (i) => typeof kinds[i] !== 'string' || kinds[i][0] === 'b';
  // A value the scanner substituted for an unquoted `$NAME` is word-split by the shell: the `$` of the
  // word as typed (`raw`) is a bare character there, where `"$NAME"` makes it a double-quoted one.
  const splits = (i) => {
    if (t[i] === raw[i] || !/\s/.test(t[i])) return false;
    const at = raw[i].indexOf('$');
    return at !== -1 && typeof kinds[i] === 'string' && kinds[i][at] === 'b';
  };
  const wordsOf = (i) => (splits(i) ? t[i].split(/\s+/).filter(Boolean) : [t[i]]);
  // The word as typed with every quoted or escaped character masked (NUL), so only bare shell syntax shows.
  const bareText = (i) => {
    const r = raw[i];
    if (typeof r !== 'string') return '';
    const k = kinds[i];
    if (typeof k !== 'string' || k.length !== r.length) return r;
    let out = '';
    for (let c = 0; c < r.length; c += 1) out += k[c] === 'b' ? r[c] : '\0';
    return out;
  };
  const render = (i) => {
    if (t[i] === raw[i]) return requote(raw[i], kinds[i]);
    return splits(i) ? wordsOf(i).map((w) => quoteValue(w, null)).join(' ') : quoteValue(t[i], kinds[i]);
  };
  return {
    t,
    bare,
    wordsOf,
    bareText,
    render,
    // The words the shell makes of word `i`, each `{ text, value, bareGlob }`: its replacement text, its
    // value, and whether the shell expands a glob character in it before the program sees it.
    items: (i) => {
      if (splits(i)) return wordsOf(i).map((w) => ({ text: quoteValue(w, null), value: w, bareGlob: GLOB_RE.test(w) }));
      let bareGlob;
      if (t[i] !== raw[i]) bareGlob = GLOB_RE.test(t[i]) && bareText(i).includes('$');
      else bareGlob = GLOB_RE.test(bareText(i));
      return [{ text: render(i), value: t[i], bareGlob }];
    },
    name: (i) => (typeof t[i] === 'string' ? P.basename(t[i]) : ''),
    isRedirect: (i) => bare(i) && REDIRECT_RE.test(t[i]),
    isRedirectOp: (i) => bare(i) && REDIRECT_OP_RE.test(t[i]),
  };
}

// The index past the segment's leading `NAME=value` assignments and keywords (LEAD_KEYWORDS), the
// assignment indices among them (kept in a replacement line; the keywords are not), and the last
// `while`/`until` keyword among them, or null.
function leadOf(seg) {
  const assignments = [];
  let conditionLoop = null;
  let i = 0;
  for (; i < seg.t.length; i += 1) {
    if (ASSIGNMENT_RE.test(seg.t[i]) && seg.bare(i)) assignments.push(i);
    else if (LEAD_KEYWORDS.has(seg.t[i]) && seg.bare(i)) {
      if (CONDITION_LOOPS.has(seg.t[i])) conditionLoop = seg.t[i];
    } else break;
  }
  return { lead: i, assignments, conditionLoop };
}

// The index of the program after any run of transparent prefix commands starting at `i`: `!` and the
// commands in PREFIX_OPTIONS, each with its own options (`t.length` when the words run out).
function skipPrefixes(seg, i) {
  const { t } = seg;
  for (;;) {
    if (t[i] === '!' && seg.bare(i)) {
      i += 1;
      continue;
    }
    const spec = PREFIX_OPTIONS.get(seg.name(i));
    if (!spec) return Math.min(i, t.length);
    i += 1;
    let optionsDone = false;
    while (i < t.length) {
      const w = t[i];
      if (spec.assignments && ASSIGNMENT_RE.test(w)) i += 1;
      else if (optionsDone || !w.startsWith('-')) break;
      else if (w === '--') { optionsDone = true; i += 1; }
      else if (spec.flags && spec.flags.test(w)) i += 1;
      else if (spec.valued && spec.valued.has(w)) i += 2;
      else break; // an option not modeled: it is taken as the program
    }
    if (spec.duration && i < t.length && !t[i].startsWith('-')) i += 1;
  }
}

// The innermost enclosing `for` loop whose variable `word` names (`$f`, `${f}`), or null.
function loopFor(word, loops) {
  const m = LOOP_VAR_RE.exec(word);
  if (!m) return null;
  const name = m[1] || m[2];
  for (let k = loops.length - 1; k >= 0; k -= 1) {
    if (loops[k].kind === 'for' && loops[k].variables[0] === name) return loops[k];
  }
  return null;
}

// Whether `word` references a variable an enclosing loop sets (a `for` variable, a `while read` name).
function mentionsLoopVariable(word, loops) {
  return loops.some((l) => l.variables.some((v) => new RegExp(`\\$\\{?${v}(?![A-Za-z0-9_])`).test(word)));
}

// The items (segmentView's `items` shape) a word naming one `for` loop's variable inside other literal
// text (`tests/$f.test.js`) stands for, one per word of the loop's literal list, or null.
function templateItems(word, loops) {
  const names = new Set([...word.matchAll(VAR_REF_RE)].map((m) => m[1] || m[2]));
  if (names.size !== 1 || EXPANSION_RE.test(word.replace(VAR_REF_RE, ''))) return null;
  const [name] = names;
  const loop = [...loops].reverse().find((l) => l.variables.includes(name));
  if (!loop || loop.kind !== 'for' || !loop.words || loop.words.some((w) => EXPANSION_RE.test(w))) return null;
  return loop.items.map((item) => {
    const value = word.replace(VAR_REF_RE, () => item.value);
    return { text: quoteValue(value, null), value, bareGlob: item.bareGlob };
  });
}

// How a run inside loops reads in a replacement, or null when its files cannot be named (an `xargs`/`find`
// lead, a loop variable over an expanded or unknown word list, any other word naming a loop variable):
// `subst` maps an operand index to the items it stands for (a `for` variable over a literal word list,
// alone or inside a path), and `drop` holds the test flags, with their value word, and the redirections,
// with their operator, that name a loop variable (the runner runs each file once, so they are left out).
function loopPlan(seg, run, loops, ledRepeat) {
  if (ledRepeat) return null;
  const { t } = seg;
  const subst = new Map();
  const drop = new Set();
  for (const i of run.operands) {
    const loop = loopFor(t[i], loops);
    if (loop) {
      if (!loop.words || loop.words.some((w) => EXPANSION_RE.test(w))) return null;
      subst.set(i, loop.items);
    } else if (mentionsLoopVariable(t[i], loops)) {
      const items = templateItems(t[i], loops);
      if (items === null) return null;
      subst.set(i, items);
    }
  }
  if (loops.some((l) => l.kind !== 'for') && run.operands.some((i) => !subst.has(i) && EXPANSION_RE.test(t[i]))) return null;
  for (let i = 0; i < run.end; i += 1) {
    if (subst.has(i) || !mentionsLoopVariable(t[i], loops)) continue;
    const r = run.role.get(i);
    if (r === 'testflag') {
      drop.add(i);
      if (run.role.get(i + 1) === 'testvalue') drop.add(i + 1);
    } else if (r === 'testvalue' && run.role.get(i - 1) === 'testflag') {
      drop.add(i - 1);
      drop.add(i);
    } else if (r === 'redirect') {
      drop.add(i);
      if (run.role.get(i - 1) === 'redirect' && seg.isRedirectOp(i - 1)) drop.add(i - 1);
    } else {
      return null;
    }
  }
  return { subst, drop };
}

// Where a direct test run's files sit: null when the run is outside the runner's reach (no runner above its
// working directory, every file under a checkout's evals/, or every literal file in no checkout), else
// `{ root, target, many }`: the working directory's checkout, the checkout whose runner the replacement
// names (the files' own when they all sit in one), and whether they are spread over more than one (a
// checkout and no checkout included). A glob or expansion word is placed by the working directory, and a
// run with no file by its working directory alone.
function placeRun(words, effCwd, ctx) {
  const P = ctx.pathImpl;
  const root = ctx.hasRunner(effCwd);
  if (!root) return null;
  const cwdInEvals = isUnder(P.resolve(effCwd), P.join(root, 'evals'), P);
  const places = words.map((w) => {
    if (GLOB_RE.test(w) || EXPANSION_RE.test(w)) return { root, evals: cwdInEvals };
    const abs = P.resolve(effCwd, w);
    const r = ctx.hasRunner(ctx.isDirectory(abs) ? abs : P.dirname(abs));
    return { root: r, evals: Boolean(r) && isUnder(abs, P.join(r, 'evals'), P) };
  });
  if (words.length === 0 ? cwdInEvals : places.every((p) => p.evals)) return null;
  const roots = [...new Set(places.map((p) => p.root))];
  if (roots.length === 1 && roots[0] === null) return null;
  return { root, target: roots.length === 1 ? roots[0] : root, many: roots.length > 1 };
}

// Whether a flag value is a path read relative to the working directory.
const isRelativePath = (v) => v !== '' && v !== 'stdout' && v !== 'stderr' && !/^(?:[\\/~$`]|[A-Za-z]:)/.test(v);

// The command-substitution nesting after word `tok` (its bare characters, segmentView's bareText, so a
// quoted or escaped one counts for nothing): `$(` opens one level, `(` inside one opens another, `)` closes
// one; a backtick opens or closes a backtick substitution.
function advanceSubstitution({ depth, tick }, tok) {
  for (let k = 0; k < tok.length; k += 1) {
    const c = tok[k];
    if (c === '`') tick = !tick;
    else if (c === '$' && tok[k + 1] === '(') { depth += 1; k += 1; }
    else if (c === '(' && depth > 0) depth += 1;
    else if (c === ')' && depth > 0) depth -= 1;
  }
  return { depth, tick };
}

// Reads the node command at `at` (up to `end`): null when it is no direct test run, else the role of each
// word after the program. A direct test run is `node` (or `npx [options] node[@<v>]`) with `--test` among
// the options before the first script operand, or a first script operand ending in `.test.js`, or (inside
// a `for` loop) a script that is the loop's variable over a word list naming a `.test.js` word. A node
// command with inline code (`-e`, `-p`) runs no script, so it is a run only with `--test`. Roles: `test`
// (the `--test` word), `dd` (`--`), `testflag`/`testvalue` (a test flag and its value word, kept),
// `foreign`/`foreignvalue` (any other option and its value word, left out of the replacement), `operand`,
// `redirect` (a redirection and its target), `substitution`. `unbalanced`: a `$(` or backtick the words
// open and never close (the scanner cut the substitution, at a `|` inside it).
function readRun(seg, at, end, loops) {
  const { t } = seg;
  let optStart;
  if (NODE_NAMES.has(seg.name(at))) {
    optStart = at + 1;
  } else if (seg.name(at) === 'npx') {
    let j = at + 1;
    while (j < end && t[j].startsWith('-') && t[j] !== '--') j += NPX_VALUE_OPTIONS.has(t[j]) ? 2 : 1;
    if (j >= end || !(t[j] === 'node' || t[j].startsWith('node@'))) return null;
    optStart = j + 1;
  } else {
    return null;
  }
  const testValues = nodeTestValueSet();
  const role = new Map();
  let sawTest = false;
  let inline = false;
  let script = -1;
  let afterDashDash = false;
  let substitution = { depth: 0, tick: false };
  for (let i = optStart; i < end; i += 1) {
    const tok = t[i];
    // The words a `$(...)` or backtick substitution spans after its first are its own command's words, never
    // node options or files: kept in the replacement as typed.
    const inside = substitution.depth > 0 || substitution.tick;
    substitution = advanceSubstitution(substitution, seg.bareText(i));
    if (inside) {
      role.set(i, 'substitution');
      continue;
    }
    if (!afterDashDash) {
      if (seg.isRedirect(i)) {
        role.set(i, 'redirect');
        if (seg.isRedirectOp(i) && i + 1 < end) {
          i += 1;
          role.set(i, 'redirect');
        }
        continue;
      }
      if (tok === '--') {
        role.set(i, 'dd');
        afterDashDash = true;
        continue;
      }
      if (tok.length > 1 && tok[0] === '-') {
        if (tok === '--test') {
          role.set(i, 'test');
          sawTest = true;
          continue;
        }
        const testFlag = tok.startsWith('--test-') || tok.startsWith('--experimental-test-');
        if (INLINE_CODE_OPTIONS.has(tok.split('=')[0])) inline = true;
        role.set(i, testFlag ? 'testflag' : 'foreign');
        const takesValue = !tok.includes('=')
          && (testValues.has(tok) || NODE_VALUE_OPTIONS.has(tok) || INLINE_CODE_OPTIONS.has(tok));
        if (takesValue && i + 1 < end) {
          i += 1;
          role.set(i, testFlag ? 'testvalue' : 'foreignvalue');
          substitution = advanceSubstitution(substitution, seg.bareText(i));
        }
        continue;
      }
    }
    if (sawTest) {
      role.set(i, 'operand');
      continue;
    }
    if (!inline) script = i;
    break;
  }
  const unbalanced = substitution.depth > 0 || substitution.tick;
  if (!sawTest) {
    if (script === -1) return null;
    const loop = loopFor(t[script], loops);
    const loopScript = Boolean(loop && loop.words && loop.words.some((w) => w.endsWith('.test.js')));
    if (!t[script].endsWith('.test.js') && !loopScript) return null;
    role.set(script, 'operand');
  }
  const operands = [...role].filter(([, r]) => r === 'operand').map(([i]) => i);
  return { at, optStart, end, sawTest, operands, role, unbalanced };
}

// The script text a `sh|bash|zsh [options] -c <text>` word list runs, or null: a `-`-cluster holding `c`
// anywhere before the shell's first non-option word makes that word the script. Each `o` or `O` in a
// cluster (`-o`, `+o`, `-euo`, `-oc`, `-O`) takes one following word as an option name; long options are
// skipped.
function wrapperText(seg, at, end) {
  const { t } = seg;
  let sawC = false;
  for (let j = at + 1; j < end; j += 1) {
    const w = t[j];
    if (w === '--') return sawC && j + 1 < end ? t[j + 1] : null;
    if (SHELL_CLUSTER_RE.test(w)) {
      if (w[0] === '-' && w.includes('c')) sawC = true;
      j += optionValueCount(w);
    } else if (!w.startsWith('--')) {
      return sawC ? w : null;
    }
  }
  return null;
}

// The program a segment runs and whether its lead repeats it, after any transparent prefix commands
// (skipPrefixes): `xargs`/`parallel` run their first non-option word (past the options that take a value),
// `find` the word after one of its `-exec`/`-execdir`/`-ok`, up to the `;` or `+` ending that action.
function programOf(seg, lead) {
  const { t } = seg;
  const runnable = (i) => NODE_NAMES.has(seg.name(i)) || seg.name(i) === 'npx' || SHELLS.has(seg.name(i));
  const start = skipPrefixes(seg, lead);
  const leadName = seg.name(start);
  const valued = REPEATING_LEADS.get(leadName);
  if (valued) {
    let j = start + 1;
    while (j < t.length && t[j].startsWith('-') && t[j] !== '--') j += valued.has(t[j]) ? 2 : 1;
    if (t[j] === '--') j += 1;
    const at = skipPrefixes(seg, j);
    return runnable(at) ? { at, end: t.length, ledRepeat: true } : null;
  }
  if (leadName === 'find') {
    for (let i = start + 1; i < t.length; i += 1) {
      if (!FIND_EXEC_ACTIONS.has(t[i])) continue;
      const at = skipPrefixes(seg, i + 1);
      let end = at + 1;
      while (end < t.length && t[end] !== ';' && t[end] !== '+') end += 1;
      if (runnable(at)) return { at, end, ledRepeat: true };
      i = end;
    }
    return null;
  }
  return { at: start, end: t.length, ledRepeat: false };
}

// The deny verdict for a direct test run, or null when it is allowed.
function judgeRun(seg, run, effCwd, { lead, assignments }, ctx, state, { ledRepeat, repeated }) {
  const P = ctx.pathImpl;
  const { t } = seg;
  if (!ctx.hasRunner(effCwd)) return null;
  const words = operandWords(seg, run, ctx, state.loops);
  const deny = repeated
    || words.length >= 2
    || (run.sawTest && words.length === 0)
    || words.some((w) => GLOB_RE.test(w) || EXPANSION_RE.test(w) || w.endsWith('/') || ctx.isDirectory(P.resolve(effCwd, w)));
  if (!deny) return null;
  const place = placeRun(words, effCwd, ctx);
  if (!place) return null;

  const other = place.target !== place.root;
  const runnerAbs = P.join(place.target, 'tools', 'run-tests.js');
  const runnerRef = quotePath(other ? toSlash(runnerAbs, P) : toSlash(P.relative(effCwd, runnerAbs), P));
  const moved = P.resolve(effCwd) !== P.resolve(ctx.callCwd);
  // `note`, when set, replaces the line with REFUSED_PLACEHOLDER and says why no command can be pasted.
  let note = null;
  if (run.unbalanced) note = CUT_SUBSTITUTION_LINE;
  else if (place.many) note = MANY_CHECKOUTS_LINE;
  let line = null;
  let expansion = false;
  let relative = false;
  let leftOut = [];
  const foreign = [];
  // A loop-variable operand becomes the loop's word list when every word is literal or a glob. The files a
  // `while`/`until` loop, an `xargs`/`find` lead or an expanded word list runs cannot be named, and no
  // replacement line may hold a loop variable, so those get the fixed placeholder text.
  const plan = note === null ? loopPlan(seg, run, state.loops, ledRepeat) : null;
  if (note === null && plan === null) {
    line = `node ${runnerRef} ${LOOP_FILES_PLACEHOLDER}`;
  } else if (note === null) {
    // Leading assignments and the prefix commands before the program, as typed.
    const parts = assignments.map(seg.render);
    for (let i = lead; i < run.at; i += 1) parts.push(seg.render(i));
    if (seg.name(run.at) === 'npx') {
      for (let i = run.at; i < run.optStart; i += 1) parts.push(seg.render(i));
      parts.push(runnerRef);
    } else {
      parts.push('node', runnerRef);
    }
    // A bare runner run selects by impact, while `node --test` with no file runs everything it finds.
    if (words.length === 0) parts.push('--full');
    // `args`: what the runner's parser receives once the shell has run the line. An unquoted glob and an
    // unresolved expansion are the shell's to expand, so an operand holding one is left out, and a flag
    // value holding one stands in as `x`.
    const args = [];
    const listed = new Set();
    for (let i = run.optStart; i < run.end; i += 1) {
      const r = run.role.get(i);
      if (r === 'test' || r === 'dd' || plan.drop.has(i)) continue;
      if (r === 'foreign' || r === 'foreignvalue') {
        foreign.push(seg.render(i));
      } else if (r === 'operand') {
        for (const item of plan.subst.get(i) || seg.items(i)) {
          if (listed.has(item.text)) continue;
          listed.add(item.text);
          parts.push(item.text);
          if (!item.bareGlob && !EXPANSION_RE.test(item.value)) args.push(plan.subst.has(i) ? item.value : homeWord(seg, i, item.value, ctx));
        }
      } else {
        parts.push(seg.render(i));
        const dynamic = EXPANSION_RE.test(t[i]);
        if (r === 'testflag') args.push(dynamic && t[i].includes('=') ? `${t[i].slice(0, t[i].indexOf('='))}=x` : t[i]);
        else if (r === 'testvalue') args.push(dynamic ? 'x' : t[i]);
        else if (r === undefined && !dynamic && !seg.items(i)[0].bareGlob) args.push(t[i]);
        // A `substitution` or `redirect` word reaches the runner as the shell's output, or not at all.
      }
    }
    if (typeof ctx.isFile === 'function') note = runnerRefusal(args, effCwd, place.target, ctx);
    if (note === null) {
      line = parts.join(' ');
      expansion = run.operands.some((i) => !plan.subst.has(i) && EXPANSION_RE.test(t[i]));
      // The runner starts node from its checkout root: a relative value is read from there.
      relative = P.resolve(effCwd) !== P.resolve(place.target) && keptPathValues(seg, run, plan).some(isRelativePath);
      leftOut = [...plan.drop].sort((a, b) => a - b).map(seg.render);
    } else {
      foreign.length = 0;
    }
  }
  if (note !== null) {
    line = REFUSED_PLACEHOLDER;
  } else if (moved) {
    const typed = state.typedDirs.get(P.resolve(effCwd));
    line = `cd ${typed !== undefined ? typed : quotePath(toSlash(P.relative(ctx.callCwd, effCwd), P))} && ${line}`;
  }
  const reason = [
    `This repository's guard blocked a direct test run. ${SAFEGUARDS_TEXT}`,
    'Run the same files through the runner, which takes the same files and node test flags:',
    '',
    line,
    ...(note !== null ? [note] : []),
    '',
    ...(expansion ? [EXPANSION_LINE] : []),
    ...(foreign.length ? [`The runner does not take ${foreign.join(' ')}; if the tests need them, set NODE_OPTIONS.`] : []),
    ...(relative ? [RELATIVE_VALUE_LINE] : []),
    ...(leftOut.length ? [`Left out because they depend on the loop: ${leftOut.join(' ')}.`] : []),
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'A single test file outside a loop can still be run directly.',
  ].join('\n');
  return { decision: 'deny', kind: 'typed', reason, replacement: line };
}

// Word `w` of word `i` with an unquoted leading `~` or `~/` read as `ctx.homedir`, as the shell expands it;
// as typed when no home directory was given, for a quoted `~`, or for `~user` (whose home is unknown).
function homeWord(seg, i, w, ctx) {
  if (typeof ctx.homedir !== 'string' || !/^~(?:\/|$)/.test(w) || seg.t[i] !== w || !seg.bareText(i).startsWith('~')) return w;
  return ctx.pathImpl.join(ctx.homedir, w.slice(1));
}

// The file words of a run's operands, a `~` word read as the home directory (homeWord), and an operand
// naming a `for` variable over a literal word list read as that list's words (loopPlan's `subst`).
function operandWords(seg, run, ctx, loops) {
  const plan = loopPlan(seg, run, loops, false);
  return run.operands.flatMap((i) => (plan && plan.subst.has(i)
    ? plan.subst.get(i).map((item) => item.value)
    : seg.wordsOf(i).map((w) => homeWord(seg, i, w, ctx))));
}

// A path the guard composed (never typed), quoted so the pasted line runs it as one word: bare when it holds
// only safe characters, in double quotes when nothing in it is special there, else in single quotes.
const quotePath = (s) => {
  if (/^[\w@%+=:,./~-]+$/.test(s)) return s;
  if (!/["$`\\!]/.test(s)) return `"${s}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
};

// The runner's refusal of `args` run from `cwd` against the checkout `repoRoot`, as the note line, or null
// when its parser accepts them. A fault in the injected isFile is let through, never read as a refusal.
function runnerRefusal(args, cwd, repoRoot, ctx) {
  let fault = null;
  const isFile = (p) => {
    try {
      return ctx.isFile(p);
    } catch (e) {
      fault = e;
      throw e;
    }
  };
  try {
    const realpath = typeof ctx.realpath === 'function' ? ctx.realpath : (p) => p;
    // The parser compares each operand's real path with the root, so the root, found as spelled, is made
    // real too: from a cwd reached through a symlink the files would otherwise read as outside the checkout.
    runner().parseRunnerOperands(args, { cwd, repoRoot: realpath(repoRoot), isFile, realpath, pathImpl: ctx.pathImpl });
    return null;
  } catch (e) {
    if (fault !== null) throw fault;
    return `The runner refuses the command as typed: ${e.message}.`;
  }
}

// The values of the kept test flags that take a path (PATH_VALUE_FLAGS), joined or in space form.
function keptPathValues(seg, run, plan) {
  const { t } = seg;
  const values = [];
  for (let i = run.optStart; i < run.end; i += 1) {
    if (run.role.get(i) !== 'testflag' || plan.drop.has(i)) continue;
    const eq = t[i].indexOf('=');
    if (eq !== -1) {
      if (PATH_VALUE_FLAGS.has(t[i].slice(0, eq))) values.push(t[i].slice(eq + 1));
    } else if (PATH_VALUE_FLAGS.has(t[i]) && run.role.get(i + 1) === 'testvalue') {
      values.push(t[i + 1]);
    }
  }
  return values;
}

const JS_SCRIPT_RE = /\.(?:js|mjs|cjs)$/;

// The index of the script operand of a `node`, `bash`, `sh` or `zsh` program: its first non-option word
// (-1 when node runs inline code or a shell its `-c` text: no file at all, and its stdin is data), or null
// (no operand: the program reads its script from stdin).
function scriptOperand(seg, prog) {
  const { t } = seg;
  const isNode = NODE_NAMES.has(seg.name(prog.at));
  const testValues = isNode ? nodeTestValueSet() : null;
  for (let i = prog.at + 1; i < prog.end; i += 1) {
    const w = t[i];
    if (seg.isRedirect(i)) {
      if (seg.isRedirectOp(i)) i += 1;
      continue;
    }
    if (w === '--') {
      // The first word after it that is no redirection, or none: then the script comes from stdin.
      for (let j = i + 1; j < prog.end; j += 1) {
        if (!seg.isRedirect(j)) return j;
        if (seg.isRedirectOp(j)) j += 1;
      }
      return null;
    }
    if (isNode) {
      if (w.length > 1 && w[0] === '-') {
        if (INLINE_CODE_OPTIONS.has(w.split('=')[0])) return -1;
        if (testValues.has(w) || NODE_VALUE_OPTIONS.has(w)) i += 1;
        continue;
      }
    } else if (SHELL_CLUSTER_RE.test(w)) {
      // A `-c` shell runs its text, so it has no script operand, and its stdin is data.
      if (w[0] === '-' && w.includes('c')) return -1;
      i += optionValueCount(w);
      continue;
    } else if (w.startsWith('--')) {
      continue;
    }
    return i;
  }
  return null;
}

// The word a `<` input redirect of the segment names, or null (a here-string or here-document is no file).
function stdinFile(seg, prog) {
  const { t } = seg;
  for (let i = prog.at + 1; i < prog.end; i += 1) {
    if (!seg.bare(i)) continue;
    if (t[i] === '<') return i + 1 < prog.end ? t[i + 1] : null;
    if (/^<[^<>&(]/.test(t[i])) return t[i].slice(1);
  }
  return null;
}

// Records the script file a segment runs in `ctx.scripts`, resolved against the segment's working directory:
// the operand of a `node` or shell program, the file a shell reads from stdin, the file `source` or `.`
// reads (shell), or the program word itself when it holds a path separator: a `/`, and under win32 path
// rules a `\` too, as `seg.name` already reads it (its `kind` is 'auto' unless an extension says: a script
// of any other name is judged by its first line).
function collectScript(seg, prog, segCwd, ctx) {
  const program = seg.t[prog.at];
  if (segCwd === null || typeof program !== 'string') return;
  const name = seg.name(prog.at);
  const isNode = NODE_NAMES.has(name);
  let word = null;
  let kind = 'shell';
  if (isNode || SHELLS.has(name)) {
    const i = scriptOperand(seg, prog);
    if (i === null) word = stdinFile(seg, prog);
    else if (i !== -1) word = seg.t[i];
    if (isNode || (word !== null && JS_SCRIPT_RE.test(word))) kind = 'js';
  } else if (program === 'source' || program === '.') {
    for (let i = prog.at + 1; i < prog.end && word === null; i += 1) {
      if (!seg.isRedirect(i)) word = seg.t[i];
      else if (seg.isRedirectOp(i)) i += 1;
    }
  } else if (program.includes('/') || (ctx.pathImpl.sep === '\\' && program.includes('\\'))) {
    word = program;
    kind = JS_SCRIPT_RE.test(program) ? 'js' : (program.endsWith('.sh') ? 'shell' : 'auto');
  }
  if (word !== null) ctx.scripts.push({ word, kind, abs: ctx.pathImpl.resolve(segCwd, word), cwd: segCwd });
}

const ENV_VALUE_OPTIONS = new Set(['-u', '--unset', '-C', '--chdir', '-P']);

// 'js' or 'shell' for a script whose first line is a `#!` naming node or a shell (directly or through
// `env`), else null: any other interpreter, or no `#!` line, is no script to scan.
function kindFromShebang(text) {
  const m = typeof text === 'string' ? /^#![ \t]*([^\r\n]*)/.exec(text) : null;
  if (!m) return null;
  const words = m[1].split(/[ \t]+/).filter(Boolean);
  let program = path.posix.basename(words[0] || '');
  if (program === 'env') {
    // env's own options (`-S`, `-i`, `-u NAME`, `-P DIR`, `--`) and `NAME=value` words come before the
    // interpreter. `-S` starts a split string, glued to it (`-Snode`) or after it, quoted or not.
    let i = 1;
    while (i < words.length && (words[i].startsWith('-') || ASSIGNMENT_RE.test(words[i]))) {
      if (/^-S./.test(words[i])) {
        words[i] = words[i].slice(2);
        break;
      }
      i += ENV_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
    }
    program = i < words.length ? path.posix.basename(words[i].replace(/^["']|["']$/g, '')) : '';
  }
  if (NODE_NAMES.has(program)) return 'js';
  return SHELLS.has(program) ? 'shell' : null;
}

// Records the directory a `cd` names when it is typed as an absolute path, so a replacement's `cd` prefix
// keeps it as typed.
function noteTypedDir(seg, prog, state, P) {
  const i = seg.t[prog.at + 1] === '--' ? prog.at + 2 : prog.at + 1;
  const dir = seg.t[i];
  if (i < prog.end && typeof dir === 'string' && P.isAbsolute(dir) && !EXPANSION_RE.test(dir)) {
    state.typedDirs.set(P.resolve(dir), seg.render(i));
  }
}

// Walks `text` segment by segment. In 'detect' mode it records whether any segment is a direct test run;
// in 'classify' mode it records the first deny. Loop nesting is tracked across segments: a segment is
// inside a loop after a `for` segment, or from a `while`/`until` segment (its condition included), up to
// that loop's own `done`; a header opens a loop only when a `do` segment follows it (directly for `for`,
// after the condition for `while`/`until`), so a loop-like line in a heredoc body the scanner hands over as
// commands (`for x in y:`) opens none. After a `pushd` or `popd` the working directory is unknown. A
// wrapper's text is walked with the loops, that mark and the typed `cd` directories in effect where the
// wrapper runs (`inherited`).
function walk(text, cwd, ctx, inherited = { loops: [], dirUnknown: false, typedDirs: new Map() }) {
  const P = ctx.pathImpl;
  const state = {
    loops: [...inherited.loops], dirUnknown: inherited.dirUnknown, typedDirs: new Map(inherited.typedDirs), found: false, result: null,
  };
  const segs = [];
  forEachCommandSegment(text, cwd, (t, effCwd, q, again) => segs.push({ seg: segmentView(t, q, P), effCwd, again }), { pathImpl: P });
  const next = (k) => {
    let j = k + 1;
    while (j < segs.length && segs[j].again) j += 1;
    return j;
  };
  const startsWith = (k, word) => k < segs.length && segs[k].seg.t[0] === word && segs[k].seg.bare(0);
  const opensLoop = (k, kind) => {
    if (kind === 'for') return startsWith(next(k), 'do');
    for (let j = next(k); j < segs.length; j = next(j)) {
      if (startsWith(j, 'do')) return true;
      const h = leadOf(segs[j].seg);
      const other = segs[j].seg.t[h.lead] === 'for' && segs[j].seg.bare(h.lead);
      if (startsWith(j, 'done') || h.conditionLoop || other) return false;
    }
    return false;
  };
  for (let k = 0; k < segs.length && !state.found && !state.result; k += 1) {
    const { seg, effCwd, again } = segs[k];
    const { t } = seg;
    const head = leadOf(seg);
    const { lead } = head;
    if (t[0] === 'done' && seg.bare(0)) {
      if (!again) state.loops.pop();
      continue;
    }
    // A `while`/`until` condition runs once per pass: its loop is open for the condition itself. A
    // `while read` condition names the loop's variables.
    if (head.conditionLoop && !again && opensLoop(k, 'while')) {
      const cmd = skipPrefixes(seg, lead);
      const variables = t[cmd] === 'read' ? t.slice(cmd + 1).filter((w) => IDENTIFIER_RE.test(w)) : [];
      state.loops.push({ kind: head.conditionLoop, variables, words: null, items: [] });
    }
    if (lead >= t.length) continue;
    if (t[lead] === 'for' && seg.bare(lead)) {
      if (!again && opensLoop(k, 'for')) {
        const hasList = t[lead + 2] === 'in';
        // Each list word's value has its unquoted leading `~` read as the home directory (homeWord).
        const items = hasList
          ? t.map((_, i) => i).slice(lead + 3).flatMap((i) => seg.items(i).map((item) => ({ ...item, value: homeWord(seg, i, item.value, ctx) })))
          : [];
        state.loops.push({
          kind: 'for',
          variables: IDENTIFIER_RE.test(t[lead + 1] || '') ? [t[lead + 1]] : [],
          words: hasList ? items.map((item) => item.value) : null,
          items,
        });
      }
      continue;
    }
    const prog = programOf(seg, lead);
    if (!prog) continue;
    if (DIR_STACK_COMMANDS.has(t[prog.at]) && seg.bare(prog.at)) {
      state.dirUnknown = true;
      continue;
    }
    if (t[prog.at] === 'cd' && seg.bare(prog.at)) noteTypedDir(seg, prog, state, P);
    const repeated = state.loops.length > 0 || prog.ledRepeat || ctx.repeated;
    const segCwd = typeof effCwd === 'string' && !state.dirUnknown ? effCwd : null;
    const isEval = !prog.ledRepeat && t[prog.at] === 'eval' && seg.bare(prog.at);
    // A direct test run's operands are test files, not scripts: the classifier judges that run.
    const testRun = ctx.mode === 'scripts' && NODE_NAMES.has(seg.name(prog.at)) && readRun(seg, prog.at, prog.end, state.loops) !== null;
    if (ctx.mode === 'scripts' && !testRun) collectScript(seg, prog, segCwd, ctx);
    if (isEval || SHELLS.has(seg.name(prog.at))) {
      // `eval` runs its arguments joined by a space; a shell its `-c` script.
      const inner = isEval ? t.slice(prog.at + 1, prog.end).join(' ') : wrapperText(seg, prog.at, prog.end);
      if (inner === null || ctx.depth >= MAX_WRAPPER_DEPTH) continue;
      if (ctx.mode === 'classify' && segCwd === null) continue;
      const sub = walk(inner, segCwd || cwd, { ...ctx, depth: ctx.depth + 1, repeated }, state);
      state.found = sub.found;
      state.result = sub.result;
      continue;
    }
    if (ctx.mode === 'scripts') continue;
    const run = readRun(seg, prog.at, prog.end, state.loops);
    if (!run) continue;
    if (ctx.mode === 'detect') {
      // Given the file-system answers (a script's scan), a run outside the runner's reach is no match.
      if (ctx.hasRunner && segCwd !== null && !placeRun(operandWords(seg, run, ctx, state.loops), segCwd, ctx)) continue;
      state.found = true;
      ctx.hits.push(t.slice(prog.at, run.end).map((_, i) => seg.render(prog.at + i)).join(' '));
      continue;
    }
    if (segCwd === null) continue;
    state.result = judgeRun(seg, run, segCwd, head, ctx, state, { ledRepeat: prog.ledRepeat, repeated });
  }
  return state;
}

// `{ decision: 'allow' }`, or `{ decision: 'deny', kind: 'typed', reason, replacement }` for the first
// denied direct test run in `command`. `hasRunner(dir)` returns the checkout root holding
// tools/run-tests.js at or above `dir`, or null; `isDirectory(absPath)` a boolean; `isFile(absPath)`, when
// given, a boolean the runner's own operand parser reads to check a replacement before it is printed (no
// check without it); `realpath(absPath)`, when given, the canonical path that check compares (the runner's
// own rule); `homedir`, when given, the directory an unquoted leading `~` or `~/` names. Lets any internal
// error (or one from the injected answers) through, so a test can tell a bug from an allow.
function classifyCommandOrThrow(command, { cwd, hasRunner, isDirectory, isFile, realpath, homedir, pathImpl = path } = {}) {
  if (typeof command !== 'string' || command === '' || typeof cwd !== 'string') return ALLOW();
  const ctx = { mode: 'classify', depth: 0, repeated: false, callCwd: cwd, hasRunner, isDirectory, isFile, realpath, homedir, pathImpl };
  return walk(command, cwd, ctx).result || ALLOW();
}

// classifyCommandOrThrow for the hook: never throws, and any internal error allows.
function classifyCommand(command, options) {
  try {
    return classifyCommandOrThrow(command, options);
  } catch (_) {
    return ALLOW();
  }
}

// The text of the first direct test run among the command segments of `text` (shell wrappers included, a
// single-file run too), or null. Given `hasRunner` and `isDirectory`, a run outside the runner's reach
// (placeRun) is skipped. Never throws: an unreadable text is no run.
function findDirectTestRun(text, { cwd, hasRunner, isDirectory, homedir, pathImpl = path } = {}) {
  try {
    if (typeof text !== 'string' || text === '') return null;
    const hits = [];
    walk(text, cwd || '.', { mode: 'detect', depth: 0, repeated: false, callCwd: cwd || '.', hasRunner, isDirectory, homedir, pathImpl, hits });
    return hits.length ? hits[0] : null;
  } catch (_) {
    return null;
  }
}

// Whether any command segment of `text` is a direct test run.
function hasDirectTestRun(text, options) {
  return findDirectTestRun(text, options) !== null;
}

const QUOTES = '\'"`';
const NODE_CODE_RE = /process\s*\.\s*(?:execPath|argv0)\b|process\s*\.\s*argv\s*\[\s*0\s*\]|process\s*\.\s*env\s*\.\s*npm_node_execpath\b/g;
const CHILD_PROCESS_NAMES = new Set(['child_process', 'node:child_process']);

// Whether a string literal's whole content names a node program (`node@20`, the npx package, included).
function isNodeName(body) {
  return body === 'node' || body === 'node.exe' || body.endsWith('/node') || body.endsWith('/node.exe') || /^node@[^\s/]+$/.test(body);
}

// The string and template literals of a JavaScript text, `{ at, body, text }`: `text` as typed, `body` its
// content, a template's `${…}` parts each replaced by `$__` (an unresolved shell expansion). `keep` is the
// text and `blank` stripComments's blank form of it, where a delimiter and a template's `${…}` code stay
// as typed and literal text is blanked.
function jsLiterals(keep, blank) {
  const isDelimiter = (i) => QUOTES.includes(keep[i]) && blank[i] === keep[i];
  const literals = [];
  for (let i = 0; i < keep.length; i += 1) {
    if (!isDelimiter(i)) continue;
    let j = i + 1;
    if (keep[i] === '`') {
      let body = '';
      let depth = 0;
      for (; j < keep.length; j += 1) {
        if (depth > 0) {
          // Code inside `${…}`: only its own braces count (a brace in a nested literal is blanked).
          if (blank[j] === '{') depth += 1;
          else if (blank[j] === '}') depth -= 1;
        } else if (keep[j] === '`' && isDelimiter(j)) {
          break;
        } else if (blank[j] === '$' && blank[j + 1] === '{') {
          depth = 1;
          j += 1;
          body += '$__';
        } else {
          body += keep[j];
        }
      }
      if (j >= keep.length) break;
      literals.push({ at: i, body, text: keep.slice(i, j + 1) });
      i = j;
      continue;
    }
    while (j < keep.length && !isDelimiter(j)) j += 1;
    if (j >= keep.length) break;
    if (keep[j] === keep[i]) {
      literals.push({ at: i, body: keep.slice(i + 1, j), text: keep.slice(i, j + 1) });
      i = j;
    }
  }
  return literals;
}

// What makes a JavaScript text one that starts node --test itself, or null: `{ ref }` or `{ literal }`.
// Reads the text with comments removed and string literals read as literals: stripComments's `blank` form
// (plugin/bin/lib/strip-comments.js) blanks comments and literal bodies, keeping delimiters and offsets, so
// a quote character the same in the text and in that form is a real delimiter, and what is code is what
// that form leaves. A `child_process` reference (in code, or a module-name literal) must hold, and then
// either an argument array (`ref`: a string literal whose whole content is `--test` and a node program,
// `process.execPath`, `process.argv[0]`, `process.argv0` or a literal naming node, the first one found) or
// a command string (`literal`: a string or template literal whose content, read as shell text, holds a
// direct test run, quoted as typed and cut at 120 characters).
function matchJs(text) {
  const { stripComments } = require('../plugin/bin/lib/strip-comments'); // lazy: most calls scan no script
  const blank = stripComments(text, { literals: 'blank' });
  const literals = jsLiterals(text, blank);
  if (!/\bchild_process\b/.test(blank) && !literals.some((l) => CHILD_PROCESS_NAMES.has(l.body))) return null;
  if (literals.some((l) => l.body === '--test')) {
    const found = literals.filter((l) => isNodeName(l.body)).map((l) => ({ at: l.at, ref: l.text }));
    for (const m of blank.matchAll(NODE_CODE_RE)) found.push({ at: m.index, ref: text.slice(m.index, m.index + m[0].length) });
    if (found.length) return { ref: found.reduce((a, b) => (b.at < a.at ? b : a)).ref };
  }
  for (const l of literals) {
    if (!l.body.includes('node') || !l.body.includes('test')) continue; // every direct test run names both
    if (findDirectTestRun(l.body, { cwd: '/', pathImpl: path.posix }) !== null) return { literal: l.text.slice(0, 120) };
  }
  return null;
}

// The line naming what a script text matched, or null when it starts no node --test. `kind` 'js': see
// matchJs. `kind` 'shell': any direct test run in the runner's reach (a script is a repeatable run by
// nature, so a single-file one is enough), its `cd`s read from `cwd`, the directory the script runs from,
// named by its text trimmed to 120 characters. Never throws.
function matchScript(text, kind, { cwd, hasRunner, isDirectory, homedir, pathImpl = path } = {}) {
  try {
    if (typeof text !== 'string') return null;
    if (kind === 'js') {
      const m = matchJs(text);
      if (m === null) return null;
      return m.ref !== undefined
        ? `Matched in the script: the string literal '--test', a child_process reference, and a node program (${m.ref}).`
        : `Matched in the script: a string literal that runs node --test as a command, and a child_process reference (${m.literal}).`;
    }
    if (kind === 'shell') {
      const run = findDirectTestRun(text, { cwd, hasRunner, isDirectory, homedir, pathImpl });
      return run === null ? null : `Matched in the script: ${run.slice(0, 120)}`;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Whether a script's text starts node --test itself (see matchScript).
function scanScript(text, kind, options) {
  return matchScript(text, kind, options) !== null;
}

// The checkout directories whose scripts are repo tooling: never read by the script scan.
const SKIPPED_SCRIPT_DIRS = new Set(['tools', 'plugin', 'tests', 'perf', 'evals', 'scripts']);

function scriptReason(word, matched) {
  return [
    `This repository's guard blocked a script that starts node --test itself: ${word}. ${SAFEGUARDS_TEXT}`,
    matched,
    'Have the script start the runner instead, from inside the checkout it tests, with the same flags and files:',
    '',
    'node tools/run-tests.js --test-reporter=tap <files>',
    '',
    'In JavaScript: spawnSync(process.execPath, [\'tools/run-tests.js\', ...flags, ...files], { cwd: checkoutRoot }). The exit code and stdout are node\'s own.',
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'If the script does not start a test run, the match is on its text: see the Matched line above.',
  ].join('\n');
}

// How much of a by-path program of unknown kind is read to find its `#!` line.
const HEAD_BYTES = 256;

// The hook's verdict for one PreToolUse payload: `{ decision: 'allow' }` or `{ decision: 'deny', reason }`.
// `deps` is { hasRunner, isDirectory, isFile, readScript(absPath) -> string|null, readHead(absPath, bytes)
// -> string|null, pathImpl }; without readHead a by-path program is read whole to find its first line. A
// non-Bash call, or one outside a checkout holding tools/run-tests.js, is allowed. Lets any error through
// (judge catches it).
function judgeOrThrow(payload, deps) {
  const { hasRunner, isDirectory, readScript, readHead, homedir, pathImpl = path } = deps;
  if (!payload || payload.tool_name !== 'Bash') return ALLOW();
  const command = payload.tool_input && payload.tool_input.command;
  const cwd = payload.cwd;
  if (typeof command !== 'string' || command === '' || typeof cwd !== 'string') return ALLOW();
  const typed = classifyCommandOrThrow(command, { ...deps, cwd });
  if (typed.decision === 'deny') return { decision: 'deny', reason: typed.reason };
  if (!hasRunner(cwd)) return ALLOW();

  const ctx = { mode: 'scripts', depth: 0, repeated: false, callCwd: cwd, pathImpl, scripts: [] };
  walk(command, cwd, ctx);
  for (const { word, kind, abs, cwd: scriptCwd } of ctx.scripts) {
    const root = hasRunner(pathImpl.dirname(abs));
    if (root) {
      const first = toSlash(pathImpl.relative(root, abs), pathImpl).split('/')[0];
      if (SKIPPED_SCRIPT_DIRS.has(first)) continue;
    }
    // A program of unknown kind is read past its first line only when that line names node or a shell.
    let scanKind = kind;
    if (kind === 'auto') {
      scanKind = kindFromShebang(typeof readHead === 'function' ? readHead(abs, HEAD_BYTES) : readScript(abs));
      if (scanKind === null) continue;
    }
    const text = readScript(abs);
    const matched = matchScript(text, scanKind, { cwd: scriptCwd, hasRunner, isDirectory, homedir, pathImpl });
    if (matched !== null) return { decision: 'deny', reason: scriptReason(word, matched) };
  }
  return ALLOW();
}

// judgeOrThrow for the hook: never throws, and any internal error allows.
function judge(payload, deps) {
  try {
    return judgeOrThrow(payload, deps);
  } catch (_) {
    return ALLOW();
  }
}

const MAX_SCRIPT_BYTES = 262144;

// The checkout root holding tools/run-tests.js at or above `dir`, as spelled, or null.
function climbToRunner(dir) {
  let d = dir;
  for (;;) {
    try {
      if (fs.statSync(path.join(d, 'tools', 'run-tests.js')).isFile()) return d;
    } catch (_) { /* not here: look one level up */ }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

// `p` with its deepest existing ancestor replaced by that ancestor's real path (the runner's canonicalPath
// rule, kept here so a Bash call with no node program never loads tools/run-tests.js). Never throws.
function realPathOf(p) {
  const below = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...below);
    } catch (_) {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      below.unshift(path.basename(current));
      current = parent;
    }
  }
}

// The file-system answers the hook reads through. None of them throws.
function realDeps() {
  let homedir;
  try {
    homedir = os.homedir();
  } catch (_) { /* no home directory: a ~ word is read as typed */ }
  return {
    pathImpl: path,
    homedir,
    // The checkout root holding tools/run-tests.js at or above `dir`, or null: first as spelled, then, for a
    // spelling through a symlink, at or above the directory's real path.
    hasRunner(dir) {
      try {
        const spelled = path.resolve(dir);
        const root = climbToRunner(spelled);
        if (root) return root;
        const real = realPathOf(spelled);
        return real === spelled ? null : climbToRunner(real);
      } catch (_) {
        return null;
      }
    },
    realpath(p) {
      try {
        return realPathOf(p);
      } catch (_) {
        return p;
      }
    },
    isDirectory(p) {
      try {
        return fs.statSync(p).isDirectory();
      } catch (_) {
        return false;
      }
    },
    isFile(p) {
      try {
        return fs.statSync(p).isFile();
      } catch (_) {
        return false;
      }
    },
    // The text of a regular file of at most MAX_SCRIPT_BYTES, else null.
    readScript(p) {
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size > MAX_SCRIPT_BYTES) return null;
        return fs.readFileSync(p, 'utf8');
      } catch (_) {
        return null;
      }
    },
    // The first `bytes` bytes of a regular file as text, else null.
    readHead(p, bytes) {
      let fd = null;
      try {
        if (!fs.statSync(p).isFile()) return null;
        fd = fs.openSync(p, 'r');
        const buf = Buffer.alloc(bytes);
        return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, bytes, 0));
      } catch (_) {
        return null;
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch (_) { /* nothing to do */ }
        }
      }
    },
  };
}

// The hook entry: stdin to end, then a deny JSON on stdout or nothing. Every failure prints nothing, and the
// exit status stays 0; the process ends on its own (an explicit exit can truncate a pending stdout write).
function main() {
  const chunks = [];
  process.stdout.on('error', () => {});
  process.stdin.on('error', () => {});
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const verdict = judge(payload, realDeps());
      if (verdict.decision === 'deny') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
        }));
      }
    } catch (_) { /* prints nothing */ }
  });
}

if (require.main === module) main();

module.exports = {
  classifyCommand, classifyCommandOrThrow, hasDirectTestRun, scanScript, judge, judgeOrThrow, realDeps, SAFEGUARDS_TEXT, PROGRAM_WORDS,
};
