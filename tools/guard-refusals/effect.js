'use strict';
// tools/guard-refusals/effect.js — #5587: whether a refused Bash command only
// reads, writes, or cannot be judged. classifyEffect(command) answers one of
//   read     every command in it is a listed reader and nothing it runs can write
//   write    something in it writes (a listed writer, a write flag, an output
//            redirect, or one of the shapes the worktree write gate itself names)
//   unknown  the command word is unlisted, computed at runtime, or runs a
//            program this classifier cannot read (node, python, bash, …)
//
// The allowlist rule: a command that can write is never `read`, and a command
// word nobody listed is `unknown`, never `read`. Every ambiguity therefore
// resolves away from `read`: an unlisted word, a command word built from `$…`
// or a glob, a `git -c` setting that can run a program, a quoting the scanner
// cannot pair up, a heredoc body that expands a substitution, or a sed script
// the scan cannot read to its end.
//
// The scan is one left-to-right pass per nesting level over the text (lexShell
// from ./shapes tells quoted, comment and heredoc text from shell structure);
// substitutions (`$(…)`, backticks, `<(…)`, `>(…)`) are classified recursively
// to a depth of 8 and blanked to one data word in the outer text. Nothing here
// uses a backtracking regex over the whole command.

const { lexShell } = require('./shapes');
const { gitTargets, fileWriteTargets, mkdirTargets } = require('../../plugin/bin/lib/hooks/git-command');
const { GATE_COVERAGE } = require('../../plugin/bin/lib/hooks/pre-tool-use');

const MAX_DEPTH = 8;
// One data word standing in for a blanked substitution in the outer text.
const SENT = '\u0001';

// word -> what makes it write. `short`: single-dash letters (matched anywhere
// in a single-dash cluster: -ni, -i.bak, -sSLo); `long`: a long flag, itself or
// `name=…` (and a unique-prefix abbreviation of at least 4 chars, as GNU
// getopt accepts); `exact`: the whole word; `prefix`: an operand prefix; `any`:
// the word writes whatever its arguments. curl's --trace/--stderr/--libcurl/
// --etag-save/--hsts/--alt-svc, -K/--config (a config file can name an output)
// and sort's --compress-program (runs a program) are additions to the brief's
// list: each can write or run a program, so none may be `read`.
const WRITE_WORDS = {
  sed: { short: 'i', long: ['--in-place'] },
  perl: { short: 'i' },
  dd: { prefix: ['of='] },
  find: { exact: ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'] },
  curl: {
    // -d/--data*/--json/-F/--form*/-T/--upload-file send a body: a remote mutation.
    short: 'oODcKdFT',
    long: ['--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '--form', '--form-string', '--upload-file', '--output', '--remote-name', '--remote-name-all', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc', '--config'],
  },
  less: { short: 'oO', long: ['--log-file', '--LOG-FILE'] },
  file: { short: 'C', long: ['--compile'] },
  sort: { short: 'o', long: ['--output', '--compress-program'] },
  rm: { any: true },
  mv: { any: true },
  cp: { any: true },
  tee: { any: true },
  install: { any: true },
  ln: { any: true },
  truncate: { any: true },
  mkdir: { any: true },
  touch: { any: true },
  chmod: { any: true },
};

// Words that only read. perl, dd, awk, xargs, tree (`-o f` writes), xxd (a second
// operand is written), hostname (an operand sets it) and date (`-s` sets the
// clock) are deliberately absent: they are `unknown`.
const READERS = [
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'stat', 'file', 'find', 'sed', 'curl', 'sort', 'jq',
  'cut', 'tr', 'diff', 'cmp', 'comm', 'basename', 'dirname', 'realpath', 'readlink', 'pwd', 'echo', 'printf', 'which', 'type', 'printenv',
  'whoami', 'id', 'uname', 'du', 'df', 'ps', 'lsof', 'pgrep', 'column', 'nl', 'od', 'hexdump', 'strings', 'sha256sum', 'shasum', 'md5',
  'md5sum', 'true', 'false', 'test', '[', '[[', 'sleep', 'cd', 'pushd', 'popd', 'export', 'unset', 'set', 'read', ':',
];
const READER_SET = new Set(READERS);
// A reader flag that runs a program (rg's preprocessor).
const RUNS_PROGRAM = { rg: ['--pre', '--hostname-bin'] };

// Unconditional git read subcommands; the conditional ones (branch tag remote
// stash worktree config reflog) are judged by their arguments in judgeGit.
const GIT_READ = [
  'status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'merge-base', 'describe', 'blame',
  'grep', 'shortlog', 'for-each-ref', 'show-ref', 'count-objects', 'var', 'check-ignore', 'name-rev', 'cherry', 'whatchanged',
];
// Every member of GATE_COVERAGE.gitActions must be here (the classifyByTables test pins it).
const GIT_WRITE = [
  'commit', 'push', 'mv', 'rm', 'update-ref', 'apply', 'fetch', 'pull', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'restore', 'add',
  'clean', 'am', 'cherry-pick', 'revert', 'gc', 'prune', 'init', 'clone', 'notes', 'submodule', 'update-index', 'write-tree', 'read-tree',
  'replace', 'filter-branch', 'bisect', 'sparse-checkout',
];
const LS_REMOTE_RUNS = ['--upload-pack', '--exec'];
const GIT_READ_SET = new Set(GIT_READ);
const GIT_WRITE_SET = new Set(GIT_WRITE);

const GH_READ = {
  pr: ['view', 'list', 'diff', 'checks', 'status'],
  issue: ['view', 'list', 'status'],
  run: ['view', 'list', 'watch'],
  repo: ['view'],
  release: ['view', 'list'],
  search: ['*'],
  auth: ['status'],
  label: ['list'],
  workflow: ['list', 'view'],
};
const GH_WRITE = {
  pr: ['merge', 'create', 'edit', 'close', 'reopen', 'comment', 'ready', 'review'],
  issue: ['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'transfer', 'pin', 'unpin', 'lock', 'unlock'],
  label: ['create', 'edit', 'delete', 'clone'],
  release: ['create', 'delete', 'upload', 'edit'],
  run: ['rerun', 'cancel', 'delete'],
  workflow: ['run', 'enable', 'disable'],
  repo: ['create', 'delete', 'edit', 'rename', 'archive', 'fork'],
};

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'select', '!', '{', '}']);
const HEADER_WORDS = new Set(['for', 'case', 'select']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh']);

// An environment variable that makes a "reader" run a program or load code.
const HAZARD_ENV = /^(?:PATH|LD_\w+|DYLD_\w+|BASH_ENV|ENV|IFS|PAGER|EDITOR|VISUAL|SHELL|LESSOPEN|LESSCLOSE|RIPGREP_CONFIG_PATH|CURL_HOME|GIT_(?:PAGER|EDITOR|SEQUENCE_EDITOR|EXTERNAL_DIFF|SSH|SSH_COMMAND|ASKPASS|EXEC_PATH|PROXY_COMMAND|CONFIG_\w+))$/;
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/;

const READ = { effect: 'read', why: 'readers only' };
const write = (why) => ({ effect: 'write', why });
const unknown = (why) => ({ effect: 'unknown', why });

function basename(word) {
  const i = word.lastIndexOf('/');
  return i === -1 ? word : word.slice(i + 1);
}

// ---------------------------------------------------------------- step 2

// Index of the `)` closing the `(` whose body starts at `from`, or -1 when it
// never closes (or the text holds an ANSI-C `$'…'`, which this scan does not
// pair). An explicit stack, not recursion, so nesting cannot overflow.
function matchParen(text, from) {
  const stack = ['paren'];
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '\\') { i++; continue; }
    if (top === 'dq') {
      if (c === '"') stack.pop();
      else if (c === '$' && text[i + 1] === '(') { stack.push('paren'); i++; }
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return -1;
      i = close;
    } else if (c === '"') stack.push('dq');
    else if (c === '$' && text[i + 1] === "'") return -1;
    else if (c === '(') stack.push('paren');
    else if (c === ')') {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

// Index of the closing unescaped backtick after `from`, or -1.
function matchBacktick(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '`') return i;
  }
  return -1;
}

// The text with each substitution blanked to SENT, the bodies to classify, and
// two flags that force `unknown`: a heredoc body that expands a substitution
// (an unquoted delimiter runs it; lexShell does not say which), and a
// substitution opened inside "…" whose body holds a `"` (lexShell pairs that
// quote differently from the shell, so what follows may be mis-lexed).
function extractSubstitutions(text, arithDepth = 0) {
  const kinds = lexShell(text);
  const n = text.length;
  const parts = [];
  const bodies = [];
  let last = 0;
  let heredocExpands = false;
  let quoteMismatch = false;
  for (let i = 0; i < n; i++) {
    const k = kinds[i];
    const c = text[i];
    if (k === 'heredoc') {
      if (c === '`' || (c === '$' && text[i + 1] === '(')) heredocExpands = true;
      continue;
    }
    if (k !== 'plain' && k !== 'double') continue;
    if (c === '\\') { i++; continue; }
    let open = 0;
    let backtick = false;
    if (c === '$' && text[i + 1] === '(' && text[i + 2] === '(') {
      // `$((…))` is arithmetic: one data word, though a substitution inside it
      // still runs. When it does not close with `))` it is a `$(` of a subshell.
      const end = matchParen(text, i + 2);
      if (end > i + 3 && text[end - 1] === ')' && arithDepth < MAX_DEPTH) {
        const inner = extractSubstitutions(text.slice(i + 3, end - 1), arithDepth + 1);
        for (const b of inner.bodies) bodies.push(b);
        heredocExpands = heredocExpands || inner.heredocExpands;
        quoteMismatch = quoteMismatch || inner.quoteMismatch;
        parts.push(text.slice(last, i), SENT);
        last = end + 1;
        i = end;
        continue;
      }
      open = 2;
    } else if (c === '$' && text[i + 1] === '(') open = 2;
    else if ((c === '<' || c === '>') && text[i + 1] === '(') open = 2;
    else if (c === '`') { open = 1; backtick = true; }
    else continue;
    const close = backtick ? matchBacktick(text, i + 1) : matchParen(text, i + 2);
    const bodyEnd = close === -1 ? n : close;
    const spanEnd = close === -1 ? n : close + 1;
    let body = text.slice(i + open, bodyEnd);
    if (backtick) body = body.replace(/\\([`\\$])/g, '$1');
    if (k === 'double' && body.includes('"')) quoteMismatch = true;
    if (body.trim() !== '') bodies.push(body);
    parts.push(text.slice(last, i), SENT);
    last = spanEnd;
    i = spanEnd - 1;
  }
  if (last === 0) return { outer: text, bodies, heredocExpands, quoteMismatch };
  parts.push(text.slice(last));
  return { outer: parts.join(''), bodies, heredocExpands, quoteMismatch };
}

// ---------------------------------------------------------------- step 3

// The simple commands of `text`: { words, redirWrite, term }. A word is
// { t: text with quotes removed, dyn: holds an expansion, glob: holds an
// unquoted glob or brace char }. `term` is the separator that ended the command
// (`;;` and `)` matter to case patterns). Comment and heredoc text belongs to
// no word; a redirect target is not a word.
function tokenize(text) {
  const kinds = lexShell(text);
  const n = text.length;
  const out = [];
  let words = [];
  let cur = null;
  let dyn = false;
  let unq = false; // holds an expansion outside quotes: word splitting can make it several words
  let glob = false;
  let redirWrite = null;
  let pending = null; // 'write' | 'skip': what the next word is
  let dbl = false; // inside [[ … ]]

  const resetWord = () => { cur = null; dyn = false; unq = false; glob = false; };
  const onlyKeywords = () => words.every((w) => KEYWORDS.has(w.t));
  const flushWord = () => {
    if (cur === null) return;
    const w = { t: cur, dyn, unq, glob };
    resetWord();
    if (pending) {
      if (pending === 'write' && w.t !== '/dev/null') redirWrite = redirWrite || 'redirect';
      pending = null;
      return;
    }
    if (dbl) { if (w.t === ']]') dbl = false; } else if (w.t === '[[' && onlyKeywords()) dbl = true;
    words.push(w);
  };
  const endCommand = (term) => {
    flushWord();
    if (pending === 'write') redirWrite = redirWrite || 'redirect';
    pending = null;
    if (words.length || redirWrite) out.push({ words, redirWrite, term });
    words = [];
    redirWrite = null;
    dbl = false;
  };
  // A redirect operator opens: a digit-only word right against it is its fd.
  const beginRedirect = () => {
    if (cur !== null && /^\d+$/.test(cur)) resetWord(); else flushWord();
    if (pending === 'write') redirWrite = redirWrite || 'redirect';
  };
  const isDigit = (ch) => ch >= '0' && ch <= '9';

  for (let i = 0; i < n; i++) {
    const k = kinds[i];
    const c = text[i];
    if (k === 'comment' || k === 'heredoc') { flushWord(); continue; }
    if (k === 'delim') { if (cur === null) cur = ''; continue; }
    if (k === 'single') { cur = (cur === null ? '' : cur) + c; continue; }
    if (k === 'double') {
      if (c === '\\' && i + 1 < n && kinds[i + 1] === 'double') {
        const nx = text[++i];
        if (nx === '\n') continue;
        cur = (cur === null ? '' : cur) + (nx === '"' || nx === '$' || nx === '\\' || nx === '`' ? '' : '\\') + nx;
        continue;
      }
      cur = (cur === null ? '' : cur) + c;
      if (c === '$' || c === SENT) dyn = true;
      continue;
    }
    // plain
    if (c === '\\' && i + 1 < n) {
      const nx = text[++i];
      if (nx !== '\n') cur = (cur === null ? '' : cur) + nx;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { flushWord(); continue; }
    if (c === '\n') { endCommand('\n'); continue; }
    if (c === ';') {
      const twin = text[i + 1] === ';';
      endCommand(twin ? ';;' : ';');
      if (twin) i++;
      continue;
    }
    // `]]` right against an operator (`]]&&`, `]]|`, `]]>f`) still closes [[ ]].
    if (dbl && cur === ']]' && (c === '&' || c === '|' || c === '<' || c === '>' || c === '(' || c === ')')) flushWord();
    if (!dbl) {
      if (c === '|') {
        endCommand(text[i + 1] === '|' ? '||' : '|');
        if (text[i + 1] === '|') i++;
        continue;
      }
      if (c === '&' && text[i + 1] === '>') { // &> and &>>
        beginRedirect();
        i++;
        if (text[i + 1] === '>') i++;
        pending = 'write';
        continue;
      }
      if (c === '&') {
        endCommand('&');
        if (text[i + 1] === '&') i++;
        continue;
      }
      if (c === '(' || c === ')') { endCommand(c); continue; }
      if (c === '>') {
        beginRedirect();
        let j = i + 1;
        if (text[j] === '>') j++;
        if (text[j] === '|') { j++; pending = 'write'; } else if (text[j] === '&') {
          let q = j + 1;
          if (text[q] === '-') q++;
          else if (isDigit(text[q])) { while (isDigit(text[q])) q++; if (text[q] === '-') q++; }
          if (q > j + 1) { i = q - 1; continue; } // >&2, >&-, N>&M: a descriptor dup
          j++;
          pending = 'write';
        } else pending = 'write';
        i = j - 1;
        continue;
      }
      if (c === '<') {
        beginRedirect();
        let j = i + 1;
        if (text[j] === '>') { j++; pending = 'write'; } else {
          while (text[j] === '<' && j < i + 3) j++;
          if (text[j] === '-') j++;
          if (text[j] === '&') j++;
          pending = 'skip';
        }
        i = j - 1;
        continue;
      }
    }
    cur = (cur === null ? '' : cur) + c;
    if (c === '$' || c === SENT) { dyn = true; unq = true; }
    if (c === '*' || c === '?' || c === '[' || c === '{') glob = true;
  }
  endCommand('');
  return out;
}

// ---------------------------------------------------------------- judging

const WRAPPERS = {
  // Each takes (words, from) and returns { next } (index of the wrapped command)
  // or { verdict }.
  env(words, from) {
    let k = from;
    for (; k < words.length; k++) {
      const a = words[k].t;
      const m = ASSIGN.exec(a);
      if (m) { if (HAZARD_ENV.test(m[1])) return { verdict: unknown(`env ${m[1]}`) }; continue; }
      if (a === '-S' || a.startsWith('-S') || a === '--split-string' || a.startsWith('--split-string=')) return { verdict: unknown('env -S') };
      if (a === '-u' || a === '--unset' || a === '-C' || a === '--chdir') { k++; continue; }
      if (a.length > 1 && a[0] === '-') continue;
      break;
    }
    return { next: k };
  },
  time(words, from) {
    let k = from;
    for (; k < words.length && words[k].t.length > 1 && words[k].t[0] === '-'; k++) {
      if (words[k].t !== '-p') return { verdict: unknown('time flags') };
    }
    return { next: k };
  },
  nice(words, from) {
    let k = from;
    while (k < words.length) {
      const a = words[k].t;
      if (a === '-n' || a === '--adjustment') k += 2;
      else if (a.length > 1 && a[0] === '-') k++;
      else break;
    }
    return { next: k };
  },
  timeout(words, from) {
    let k = from;
    while (k < words.length) {
      const a = words[k].t;
      if (a === '-s' || a === '--signal' || a === '-k' || a === '--kill-after') k += 2;
      else if (a.length > 1 && a[0] === '-') k++;
      else break;
    }
    return { next: k + 1 }; // the duration
  },
  nohup: (words, from) => ({ next: from }),
  command(words, from) {
    let k = from;
    if (k < words.length && (words[k].t === '-v' || words[k].t === '-V')) return { verdict: READ };
    if (k < words.length && words[k].t === '-p') k++;
    return { next: k };
  },
};

// Single-dash curl options that take a value (the rest of the cluster, or the next word).
const CURL_VALUE_SHORT = 'AbcCdDeEFHKmoPQrtTuUwxyYz';

// curl with a request method other than GET/HEAD (-X, --request, --request=,
// -XPOST, a cluster ending in X) mutates the remote: a write, as `gh api` is.
function curlMutates(words, from) {
  // `-w '%output{f}'` (curl 8.3+) writes a file.
  for (let k = from; k < words.length; k++) if (words[k].t.includes('%output{')) return true;
  for (let k = from; k < words.length; k++) {
    const a = words[k].t;
    let method = null;
    if (a === '--request') method = k + 1 < words.length ? words[k + 1] : { t: '', dyn: true };
    else if (a.startsWith('--request=')) method = { t: a.slice('--request='.length), dyn: words[k].dyn };
    else if (a.length > 1 && a[0] === '-' && a[1] !== '-') {
      // Scan the cluster letter by letter: a letter that takes a value ends it.
      for (let m = 1; m < a.length; m++) {
        if (a[m] === 'X') {
          method = m + 1 < a.length ? { t: a.slice(m + 1), dyn: words[k].dyn } : (words[k + 1] || { t: '', dyn: true });
          break;
        }
        if (CURL_VALUE_SHORT.includes(a[m])) break;
      }
    }
    // curl sends the method as typed: only literal GET and HEAD are reads.
    if (method && (method.dyn || !['GET', 'HEAD'].includes(method.t))) return true;
  }
  return false;
}

// A computed argument could itself be a write flag (`sed "$OPTS" …`, `rg $FLAGS x`):
// a word that starts with an expansion, or holds an unquoted one anywhere (word
// splitting makes new words), is computed. The never-read rule wins over precision.
function computedArg(words, from) {
  for (let k = from; k < words.length; k++) {
    const w = words[k];
    if (w.dyn && (w.unq || w.t[0] === '$' || w.t[0] === SENT)) return true;
  }
  return false;
}

function hitsWrite(entry, words, from) {
  if (entry.any) return true;
  for (let k = from; k < words.length; k++) {
    const a = words[k].t;
    if (entry.prefix && entry.prefix.some((p) => a.startsWith(p))) return true;
    if (entry.exact && entry.exact.includes(a)) return true;
    if (a.length < 2 || a[0] !== '-') continue;
    if (a[1] !== '-') {
      if (entry.short && [...entry.short].some((ch) => a.indexOf(ch, 1) !== -1)) return true;
    } else if (entry.long) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (entry.long.some((l) => name === l || (name.length >= 4 && l.startsWith(name)))) return true;
    }
  }
  return false;
}

// -------- sed scripts

// A sed script is a program: `w file`, `W file` and the `s///w file` flag write a file, and the `e` command
// and the `s///e` flag run one. So a sed call without -i is `read` only when its script can be read to the end
// and holds none of them; a script file, a computed script, an option this table does not know and a script
// the scan cannot follow are `unknown`.
const SED_BARE_SHORT = 'nErsuza';
const SED_BARE_LONG = new Set(['--quiet', '--silent', '--regexp-extended', '--separate', '--unbuffered', '--null-data', '--zero-terminated', '--posix', '--debug', '--sandbox', '--follow-symlinks', '--binary', '--help', '--version']);
const SED_NO_ARG = '=dDgGhHlnNpPxzFqQL';
const SED_ADDRESS = '0123456789$,~+!{}IM';
const SED_S_FLAGS = 'gpiImM0123456789';

// 'write', 'unknown' (not readable with confidence) or null (only edits its stream). One forward pass: every
// branch moves `i` on, and `section` never looks back.
function sedScriptEffect(text) {
  const n = text.length;
  // The index after the delimiter `d` that closes a section opened before `from`, or -1 when it never closes,
  // holds a raw newline, or (`regex`) holds `d` inside a bracket expression, which sed implementations split
  // differently.
  const section = (from, d, regex) => {
    if (d === undefined || d === '\\' || d === '\n' || d === '[' || d === ']') return -1;
    let inBracket = false;
    let literalUntil = 0; // a `]` right after `[` or `[^` is a literal
    for (let j = from; j < n; j++) {
      const c = text[j];
      if (c === '\n') return -1;
      if (c === '\\') { j++; continue; }
      if (regex && inBracket) {
        if (c === d) return -1;
        if (c === '[' && (text[j + 1] === ':' || text[j + 1] === '.' || text[j + 1] === '=')) {
          const close = text.indexOf(`${text[j + 1]}]`, j + 2);
          if (close === -1) return -1;
          j = close + 1;
        } else if (c === ']' && j >= literalUntil) inBracket = false;
        continue;
      }
      if (c === d) return j + 1;
      if (regex && c === '[') { inBracket = true; literalUntil = j + (text[j + 1] === '^' ? 3 : 2); }
    }
    return -1;
  };
  const lineEnd = (from) => { const nl = text.indexOf('\n', from); return nl === -1 ? n : nl; };

  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ';' || SED_ADDRESS.includes(c) || SED_NO_ARG.includes(c)) { i++; continue; }
    if (c === 'w' || c === 'W' || c === 'e') return 'write';
    if (c === '#') { i = lineEnd(i); continue; }
    if (c === '/' || c === '\\') { // a regex address: /re/ or \cREc
      const open = c === '/' ? i : i + 1;
      const end = section(open + 1, text[open], true);
      if (end === -1) return 'unknown';
      i = end;
      continue;
    }
    if (c === 's' || c === 'y') {
      const d = text[i + 1];
      const mid = section(i + 2, d, c === 's');
      let end = mid === -1 ? -1 : section(mid, d, false);
      if (end === -1) return 'unknown';
      if (c === 's') {
        while (end < n && SED_S_FLAGS.includes(text[end])) end++;
        if (text[end] === 'w' || text[end] === 'e') return 'write';
      }
      i = end;
      continue;
    }
    if (c === 'a' || c === 'i' || c === 'c') { // text to the end of the line; a backslash carries it over a newline
      let j = i + 1;
      while (j < n && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (c === 'r' || c === 'R') { i = lineEnd(i); continue; } // a file name to the end of the line
    if (c === ':' || c === 'b' || c === 't' || c === 'T' || c === 'v') { // a label or version, to `;` or the end of the line
      let j = i + 1;
      while (j < n && text[j] !== '\n' && text[j] !== ';') j++;
      i = j;
      continue;
    }
    return 'unknown';
  }
  return null;
}

// The verdict for `sed` without -i, or null when its script only edits the stream. GNU sed takes options after
// the first operand and BSD sed takes that operand as the script, so when a script option appears only after
// the first operand both readings are judged and the worse one wins.
function judgeSed(words, from) {
  const given = []; // script words from -e / --expression
  let firstOperand = null;
  let optionBeforeOperand = false;
  let options = true;
  for (let k = from; k < words.length; k++) {
    const w = words[k];
    const a = w.t;
    if (!options || a.length < 2 || a[0] !== '-') { firstOperand = firstOperand || w; continue; }
    if (a === '--') { options = false; continue; }
    let script = null;
    if (a[1] === '-') {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (name === '--file') return unknown('sed script file');
      if (name === '--expression') script = eq === -1 ? (words[++k] || null) : { ...w, t: a.slice(eq + 1) };
      else if (name === '--line-length') { if (eq === -1) k++; continue; } else if (!SED_BARE_LONG.has(a)) return unknown('sed option');
      else continue;
    } else {
      let m = 1;
      for (; m < a.length && SED_BARE_SHORT.includes(a[m]); m++);
      if (m === a.length) continue;
      if (a[m] === 'f') return unknown('sed script file');
      if (a[m] !== 'e') return unknown('sed option');
      script = m + 1 < a.length ? { ...w, t: a.slice(m + 1) } : (words[++k] || null);
    }
    if (!script) return unknown('sed option');
    given.push(script);
    if (!firstOperand) optionBeforeOperand = true;
  }
  const readings = [];
  if (given.length) readings.push(given);
  if (firstOperand && !optionBeforeOperand) readings.push([firstOperand]);
  let worst = null;
  for (const scripts of readings) {
    if (scripts.some((w) => w.dyn)) { worst = worst || unknown('sed script computed'); continue; }
    const effect = sedScriptEffect(scripts.map((w) => w.t).join('\n'));
    if (effect === 'write') return write('sed script writes or runs a program');
    if (effect === 'unknown') worst = worst || unknown('sed script unreadable');
  }
  return worst;
}

// -------- git

const GIT_BARE_FLAGS = new Set(['--no-pager', '-p', '--paginate', '-P', '--no-optional-locks', '--bare', '--no-replace-objects', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-lazy-fetch', '--no-advice']);
const GIT_VALUE_FLAGS = new Set(['--git-dir', '--work-tree', '--namespace']);
// A `-c key=value` whose key can run a program (and any `include` path, which
// can set one).
const GIT_PROGRAM_KEY = /^(?:core\.|alias\.|include\.|includeif\.)|\.(?:pager|editor|command|cmd|program|helper|textconv|smudge|clean|process|driver|external|sshcommand|path)$/;

const GIT_CONFIG_WRITE_LONG = ['--unset', '--unset-all', '--add', '--replace-all', '--edit', '--rename-section', '--remove-section'];
const BRANCH_WRITE_SHORT = 'dDmMcCuf';
const BRANCH_WRITE_LONG = ['--delete', '--move', '--copy', '--set-upstream-to', '--unset-upstream', '--edit-description', '--force'];
const GIT_LIST_FLAGS = ['--list', '-l', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at'];

function firstOperand(words, from) {
  for (let k = from; k < words.length; k++) if (words[k].t[0] !== '-' || words[k].t === '-') return words[k].t;
  return null;
}

function branchOrTag(sub, words, from) {
  const shortWrite = sub === 'tag' ? `${BRANCH_WRITE_SHORT}a` : BRANCH_WRITE_SHORT;
  let list = false;
  let operands = 0;
  for (let k = from; k < words.length; k++) {
    const a = words[k].t;
    if (a.length > 1 && a[0] === '-') {
      if (a[1] === '-') {
        const eq = a.indexOf('=');
        const name = eq === -1 ? a : a.slice(0, eq);
        if (BRANCH_WRITE_LONG.some((l) => name === l || (name.length >= 4 && l.startsWith(name)))) return write(`git ${sub} ${name}`);
        if (GIT_LIST_FLAGS.includes(name)) list = true;
      } else {
        for (let m = 1; m < a.length; m++) if (shortWrite.includes(a[m])) return write(`git ${sub} ${a}`);
        if (a.includes('l', 1)) list = true;
      }
    } else operands++;
  }
  return list || operands === 0 ? READ : write(`git ${sub} create`);
}

function judgeGit(words, from) {
  const verdict = judgeGitWords(words, from);
  if (verdict.effect !== 'read') return verdict;
  // A computed argument could be `--output=f`; words after a literal `--` are paths only.
  const sub = gitSubIndex(words, from);
  if (sub !== -1) {
    const end = words.findIndex((w, k) => k > sub && w.t === '--');
    if (computedArg(end === -1 ? words : words.slice(0, end), sub + 1)) return unknown('computed argument');
  }
  return verdict;
}

// Index of the git subcommand word (after the global options judgeGitWords skips), or -1.
function gitSubIndex(words, from) {
  for (let k = from; k < words.length; k++) {
    const a = words[k].t;
    if (a === '-C' || a === '-c') { k++; continue; }
    if (GIT_BARE_FLAGS.has(a)) continue;
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (GIT_VALUE_FLAGS.has(name)) { if (eq === -1) k++; continue; }
    if (a[0] === '-') return -1;
    return k;
  }
  return -1;
}

function judgeGitWords(words, from) {
  let k = from;
  for (; k < words.length; k++) {
    const a = words[k].t;
    if (a === '-C') { k++; continue; }
    if (a === '-c') {
      const kv = words[k + 1];
      const key = kv ? kv.t.split('=')[0].toLowerCase() : '';
      if (!kv || kv.dyn || GIT_PROGRAM_KEY.test(key)) return unknown(`git -c ${key}`);
      k++;
      continue;
    }
    if (GIT_BARE_FLAGS.has(a)) continue;
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (GIT_VALUE_FLAGS.has(name)) { if (eq === -1) k++; continue; }
    if (a[0] === '-') return unknown(`git ${a}`);
    break;
  }
  if (k >= words.length) return unknown('git');
  const sub = words[k].t;
  const rest = k + 1;
  for (let m = rest; m < words.length; m++) {
    const a = words[m].t;
    if (a.length >= 4 && a[0] === '-' && a[1] === '-') {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (name.length >= 4 && '--output'.startsWith(name)) return write(`git ${sub} --output`);
    }
  }
  switch (sub) {
    case 'branch':
    case 'tag':
      return branchOrTag(sub, words, rest);
    case 'remote': {
      const op = firstOperand(words, rest);
      if (op === null || op === 'show' || op === 'get-url') return READ;
      if (['add', 'remove', 'rm', 'set-url', 'rename', 'prune', 'update', 'set-head', 'set-branches'].includes(op)) return write(`git remote ${op}`);
      return unknown('git remote');
    }
    case 'stash': {
      const op = firstOperand(words, rest);
      return op === 'list' || op === 'show' ? READ : write('git stash');
    }
    case 'worktree':
      return firstOperand(words, rest) === 'list' ? READ : write('git worktree');
    case 'reflog': {
      const op = firstOperand(words, rest);
      return op === 'expire' || op === 'delete' ? write(`git reflog ${op}`) : READ;
    }
    case 'config': {
      let operands = 0;
      for (let m = rest; m < words.length; m++) {
        const a = words[m].t;
        if (['-e', 'set', 'unset', 'edit'].includes(a)) return write('git config');
        if (a[0] === '-' && a[1] === '-') {
          const eq = a.indexOf('=');
          const name = eq === -1 ? a : a.slice(0, eq);
          if (name.length >= 4 && GIT_CONFIG_WRITE_LONG.some((l) => l.startsWith(name))) return write('git config');
        }
        if (a[0] !== '-' || a === '-') operands++;
      }
      return operands >= 2 ? write('git config') : READ;
    }
    default:
  }
  if (GIT_READ_SET.has(sub)) {
    if (sub === 'grep') {
      for (let m = rest; m < words.length; m++) if (words[m].t.startsWith('-O') || words[m].t.startsWith('--open-files-in-pager')) return unknown('git grep -O');
    }
    if (sub === 'ls-remote') {
      // --upload-pack=<cmd> and --exec=<cmd> run a program against a local or ssh remote (unique-prefix abbreviations count).
      for (let m = rest; m < words.length; m++) {
        const a = words[m].t;
        if (a[0] !== '-' || a[1] !== '-') continue;
        const eq = a.indexOf('=');
        const name = eq === -1 ? a : a.slice(0, eq);
        if (name.length >= 4 && LS_REMOTE_RUNS.some((l) => l.startsWith(name))) return unknown('git ls-remote runs a program');
      }
    }
    return READ;
  }
  if (GIT_WRITE_SET.has(sub)) return write(`git ${sub}`);
  return unknown(`git ${sub}`);
}

// -------- gh

function inTable(table, group, sub) {
  const subs = Object.hasOwn(table, group) ? table[group] : null;
  return Boolean(subs && (subs.includes('*') || subs.includes(sub)));
}

const GH_API_VALUE_FLAGS = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--cache', '-p', '--preview', '--hostname']);

function judgeGhApi(words, from) {
  let method = null;
  let hasInput = false;
  let endpoint = null;
  const fields = [];
  for (let k = from; k < words.length; k++) {
    const w = words[k];
    const a = w.t;
    if (a === '-X' || a === '--method') { method = words[++k] || { t: '', dyn: true }; continue; }
    if (a.startsWith('--method=')) { method = { t: a.slice(9), dyn: w.dyn }; continue; }
    if (a.length > 2 && a.startsWith('-X')) { method = { t: a.slice(2), dyn: w.dyn }; continue; }
    if (a === '-f' || a === '-F' || a === '--field' || a === '--raw-field') { if (words[k + 1]) fields.push(words[++k]); continue; }
    const fm = /^--(?:field|raw-field)=/.exec(a);
    if (fm) { fields.push({ t: a.slice(fm[0].length), dyn: w.dyn }); continue; }
    if (a.length > 2 && (a.startsWith('-f') || a.startsWith('-F')) && a[2] !== '-') { fields.push({ t: a.slice(2), dyn: w.dyn }); continue; }
    if (a === '--input') { hasInput = true; k++; continue; }
    if (a.startsWith('--input=')) { hasInput = true; continue; }
    if (GH_API_VALUE_FLAGS.has(a)) { k++; continue; }
    if (a.length > 1 && a[0] === '-') continue;
    if (endpoint === null) endpoint = a;
  }
  if (endpoint === null) return unknown('gh api');
  // An unquoted expansion can split into -X DELETE, -f body=… or --input: a read verdict below is only as sure as the words are literal.
  const computed = computedArg(words, from);
  const readOrUnknown = () => (computed ? unknown('computed argument') : READ);
  if (endpoint === 'graphql') {
    if (hasInput) return unknown('gh api graphql');
    let verdict = null;
    for (const f of fields) {
      if (!f.t.startsWith('query=')) continue;
      if (f.dyn) return unknown('gh api graphql');
      const value = f.t.slice('query='.length).trim();
      if (value.startsWith('@')) return unknown('gh api graphql');
      if (value.startsWith('mutation')) return write('gh api graphql mutation');
      if (value.startsWith('query') || value.startsWith('{')) {
        if (/\bmutation\b/.test(value)) return write('gh api graphql mutation');
        verdict = verdict || READ;
      } else return unknown('gh api graphql');
    }
    return verdict ? readOrUnknown() : unknown('gh api graphql');
  }
  if (method && method.dyn) return unknown('gh api');
  if (method && method.t.toUpperCase() === 'GET') return readOrUnknown();
  if (method) return write(`gh api ${method.t.toUpperCase()}`);
  return fields.length || hasInput ? write('gh api field') : readOrUnknown();
}

function judgeGh(words, from) {
  let k = from;
  while (k < words.length && words[k].t[0] === '-') k += words[k].t === '-R' || words[k].t === '--repo' ? 2 : 1;
  if (k >= words.length) return unknown('gh');
  const group = words[k].t;
  if (group === 'api') return judgeGhApi(words, k + 1);
  const sub = firstOperand(words, k + 1);
  if (inTable(GH_WRITE, group, sub)) return write(`gh ${group} ${sub}`);
  if (inTable(GH_READ, group, sub)) return READ;
  return unknown(`gh ${group}${sub ? ` ${sub}` : ''}`);
}

// -------- the rest

function unknownWhy(base, words, from) {
  if (base === 'node') {
    for (let k = from; k < words.length; k++) {
      const a = words[k].t;
      if (a === '-e' || a === '-p' || a === '--eval' || a === '--print' || a.startsWith('--eval=') || a.startsWith('--print=')) return 'node -e';
      if (a[0] !== '-') break;
    }
    return 'node script';
  }
  if (/^python[0-9.]*$/.test(base)) return 'python3';
  if (base === 'playwright-cli') return 'playwright-cli';
  if (SHELLS.has(base)) return 'bash';
  return `unlisted word: ${base.length > 80 ? `${base.slice(0, 80)}…` : base}`;
}

function judgeWords(words, start) {
  let s = start;
  for (;;) {
    const w = words[s];
    if (w.dyn || (w.glob && w.t !== '[' && w.t !== '[[' && w.t !== '{')) return unknown('computed command name');
    // An absolute path runs the program its basename names; a relative one may be any local script.
    if (w.t.includes('/') && w.t[0] !== '/') return unknown('relative path command');
    const base = basename(w.t);
    if (Object.hasOwn(WRAPPERS, base)) {
      const r = WRAPPERS[base](words, s + 1);
      if (r.verdict) return r.verdict;
      if (r.next >= words.length) return READ;
      s = r.next;
      continue;
    }
    const entry = Object.hasOwn(WRITE_WORDS, base) ? WRITE_WORDS[base] : null;
    if (entry && hitsWrite(entry, words, s + 1)) return write(`write word: ${base}`);
    if (base === 'curl' && curlMutates(words, s + 1)) return write('write word: curl');
    if (entry && !entry.any && computedArg(words, s + 1)) return unknown('computed argument');
    if (base === 'sed') {
      const verdict = judgeSed(words, s + 1);
      if (verdict) return verdict;
    }
    if (base === 'export') {
      for (let k = s + 1; k < words.length; k++) {
        const m = ASSIGN.exec(words[k].t);
        if (m && HAZARD_ENV.test(m[1])) return unknown(`env ${m[1]}`);
      }
    }
    if (base === 'git') return judgeGit(words, s + 1);
    if (base === 'gh') return judgeGh(words, s + 1);
    if (READER_SET.has(base)) {
      if (Object.hasOwn(RUNS_PROGRAM, base) && computedArg(words, s + 1)) return unknown('computed argument');
      if (Object.hasOwn(RUNS_PROGRAM, base) && words.slice(s + 1).some((x) => RUNS_PROGRAM[base].includes(x.t.split('=')[0]))) return unknown(`${base} runs a program`);
      return READ;
    }
    return unknown(unknownWhy(base, words, s + 1));
  }
}

function classifyText(text, depth) {
  if (depth > MAX_DEPTH) return unknown('nesting');
  const { outer, bodies, heredocExpands, quoteMismatch } = extractSubstitutions(text);
  let firstWrite = null;
  let firstUnknown = null;
  const add = (r) => {
    if (r.effect === 'write') firstWrite = firstWrite || r;
    else if (r.effect === 'unknown') firstUnknown = firstUnknown || r;
  };
  if (quoteMismatch) add(unknown('nested quotes'));
  if (heredocExpands) add(unknown('heredoc expansion'));

  let caseDepth = 0;
  let casePattern = false;
  // for-of walks entries pushed during the loop: a `for f do …` body is queued.
  const commands = tokenize(outer);
  for (const cmd of commands) {
    if (casePattern && cmd.words[0] && cmd.words[0].t === 'esac') casePattern = false;
    if (casePattern && (cmd.term === ')' || cmd.term === '|')) {
      if (cmd.term === ')') casePattern = false;
      continue;
    }
    const { words } = cmd;
    let s = 0;
    for (; s < words.length; s++) {
      const t = words[s].t;
      if (HEADER_WORDS.has(t)) break;
      if (KEYWORDS.has(t)) {
        if (t === 'esac') { caseDepth = Math.max(0, caseDepth - 1); casePattern = false; }
        continue;
      }
      const m = ASSIGN.exec(t);
      if (!m) break;
      if (HAZARD_ENV.test(m[1])) add(unknown(`env ${m[1]}`));
    }
    if (cmd.redirWrite) add(write(cmd.redirWrite));
    if (s < words.length) {
      const head = words[s].t;
      if (head === 'case') {
        caseDepth++;
        casePattern = cmd.term !== ')';
      } else if (head === 'for' || head === 'select') {
        // The header is data, but `for f do BODY` (no `in`, no `;`) puts the body in it.
        const doAt = words.findIndex((x, j) => j > s && x.t === 'do');
        if (doAt !== -1 && doAt + 1 < words.length) commands.push({ words: words.slice(doAt + 1), redirWrite: null, term: cmd.term });
      } else add(judgeWords(words, s));
    }
    if (caseDepth > 0 && cmd.term === ';;') casePattern = true;
  }
  for (const body of bodies) add(classifyText(body, depth + 1));
  return firstWrite || firstUnknown || READ;
}

// A file, mkdir or gated-git write the worktree write gate itself recognises.
function gateWrite(command) {
  for (const targets of [fileWriteTargets, mkdirTargets]) {
    const t = targets(command, '/');
    if (t && t.length) return `git-command: ${t[0].action}`;
  }
  const hit = gitTargets(command, '/').find((t) => GATE_COVERAGE.gitActions.includes(t.action));
  return hit ? `git-command: ${hit.action}` : null;
}

function classifyEffect(command) {
  if (typeof command !== 'string' || command.trim() === '') return unknown('empty');
  // The scan first: the write gate is the slow half, and only the `why` differs.
  const scanned = classifyText(command, 0);
  if (scanned.effect === 'write') return scanned;
  // A gate that throws cannot vouch for a `read` the scan reached: fail closed, never open.
  let gated;
  try { gated = gateWrite(command); } catch { return scanned.effect === 'read' ? unknown('write gate failed') : scanned; }
  return gated ? write(gated) : scanned;
}

// The word tables alone, without step 1's gate: lets a test prove each table
// member writes on its own rather than being masked by git-command.js.
const classifyByTables = (command) => classifyText(command, 0);

module.exports = { classifyEffect, classifyByTables, WRITE_WORDS, READERS, GIT_READ, GH_READ, GIT_WRITE, GH_WRITE };
