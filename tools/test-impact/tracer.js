'use strict';
// tools/test-impact/tracer.js — the test-impact read tracer (#4024).
//
// A `--require` preload carried by NODE_OPTIONS into every node process of a traced `node --test`
// run. It records which repo paths each test file reads, for tools/test-impact.js to fold into a
// test-impact map. Inert unless CT_TRACE_ROOT (realpath of the repo) and CT_TRACE_DIR are set.
//
// Attribution: CT_TRACE_TEST, else — when NODE_TEST_CONTEXT is set (a `node --test` worker) and
// process.argv[1] is under the root — the repo-relative test path, then exported as CT_TRACE_TEST so
// children inherit it. An unattributed process patches nothing.
//
// Output: each attributed process appends JSON lines to `{CT_TRACE_DIR}/{pid}-{ms}-{rand}.trace` —
// `["T", test]` first, then `[kind, relPath]` once per unique pair, written immediately with the
// unpatched appendFileSync. JSON, not tab-separated, because fixture paths hold tabs and newlines.
// Kinds: f content read (read/open/copy source/stat/lstat/module load/cp of a file), s existence probe
// (exists/access/realpath/readlink, and every resolution candidate of a relative or absolute require),
// d directory listing (readdir/opendir), c content prefix (a cp of a directory, a non-node child's in-repo
// directory argument, or a content-reading git subcommand — its cwd, or a pathspec's literal prefix). Paths
// under `.git/` and outside the root are dropped; `''` is the root itself.
//
// Children: a child_process call with an explicit `env` gets CT_TRACE_* and the CT_TRACE_REQUIRE token
// (`--require "{abs tracer}"`) appended to its NODE_OPTIONS, so a test spawning node with a clean env
// is still traced; an env already naming a different CT_TRACE_ROOT is a nested trace and left alone.
// Node children trace themselves; for other children the in-repo path arguments are recorded here.
//
// Invariants (each one broke the full suite in the spike): wrapped functions copy the original's own
// property descriptors (util.promisify.custom — `promisify(execFile)` must keep resolving
// {stdout, stderr}); the tracer never calls process.cwd() — Node caches the cwd, so an eager call
// changes what a later one answers once the cwd is deleted — it reads the cwd through the unpatched
// realpathSync.native('.') only when a path is relative; it is silent and never throws into the host.

const ROOT_ENV = process.env.CT_TRACE_ROOT;
const DIR_ENV = process.env.CT_TRACE_DIR;
// Fail closed: once a test is attributed, any patch that cannot be installed (or a recording hook that
// throws) records `["c", ""]` — the whole-repo prefix, which selects the test for every change — so a
// broken install over-selects instead of silently under-recording. Set by install() once it can emit.
let failClosed = null;
if (ROOT_ENV && DIR_ENV) {
  try {
    install();
  } catch (_) {
    // never break the traced process
    if (failClosed) failClosed();
  }
}

function install() {
  const fs = require('fs');
  const path = require('path');
  const util = require('util');
  const cp = require('child_process');
  const Module = require('module');
  const { fileURLToPath } = require('url');

  // Unpatched originals the tracer itself uses.
  const appendFileSync = fs.appendFileSync;
  const statSync = fs.statSync;
  const realpathNative = fs.realpathSync.native;

  const stripSep = (p) => (p.length > 1 && (p.endsWith('/') || p.endsWith(path.sep)) ? p.slice(0, -1) : p);

  // The current cwd without process.cwd() (whose cache would change the host's own later calls), or
  // null when it cannot be read (deleted).
  function currentCwd() {
    try {
      return realpathNative('.');
    } catch (_) {
      return null;
    }
  }

  function toPathString(p) {
    if (typeof p === 'string') return p;
    if (Buffer.isBuffer(p)) return p.toString();
    if (p && typeof p === 'object' && p.protocol === 'file:' && typeof p.href === 'string') return fileURLToPath(p);
    return null;
  }

  // Absolute path of `s` against `base` (an absolute dir; undefined = the process cwd, read lazily), or null.
  function toAbs(s, base) {
    if (typeof s !== 'string') return null;
    if (path.isAbsolute(s)) return stripSep(path.normalize(s));
    let b = base;
    if (b === undefined) b = currentCwd();
    if (!b) return null;
    return stripSep(path.join(b, s));
  }

  if (!path.isAbsolute(ROOT_ENV) || !path.isAbsolute(DIR_ENV)) return;
  const roots = [stripSep(path.normalize(ROOT_ENV))];
  try {
    const real = stripSep(realpathNative(ROOT_ENV));
    if (!roots.includes(real)) roots.push(real);
  } catch (_) {
    // root not resolvable: compare against the given form only
  }

  // Repo-relative POSIX path of absolute `abs`, or null when outside the root or under `.git/`.
  function relOf(abs) {
    if (typeof abs !== 'string') return null;
    for (const root of roots) {
      let r = null;
      if (abs === root) r = '';
      else {
        const prefix = root.endsWith(path.sep) ? root : root + path.sep;
        if (abs.startsWith(prefix)) r = abs.slice(prefix.length);
      }
      if (r === null) continue;
      r = r.split(path.sep).join('/');
      if (r === '.git' || r.startsWith('.git/')) return null;
      return r;
    }
    return null;
  }

  let test = process.env.CT_TRACE_TEST || null;
  if (!test && process.env.NODE_TEST_CONTEXT && typeof process.argv[1] === 'string') {
    const r = relOf(toAbs(process.argv[1], undefined));
    if (r) {
      test = r;
      process.env.CT_TRACE_TEST = test;
    }
  }
  if (!test) return;

  const out = path.join(DIR_ENV, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.trace`);
  const seen = new Set();
  let headerWritten = false;
  function emit(kind, r) {
    const line = JSON.stringify([kind, r]);
    if (seen.has(line)) return;
    try {
      if (!headerWritten) {
        appendFileSync(out, `${JSON.stringify(['T', test])}\n`);
        headerWritten = true;
      }
      appendFileSync(out, `${line}\n`);
      // Remembered only once written: a transient failure (EMFILE, ENOSPC) must not make this read
      // look recorded, so the next identical read retries it instead of being deduped away.
      seen.add(line);
    } catch (_) {
      // never break the traced process
    }
  }
  failClosed = () => emit('c', '');

  // Records `p` (a path argument, relative to `base`) as `kind`; 'auto' picks d/f by what is on disk.
  function record(kind, p, base) {
    const s = toPathString(p);
    if (s === null) return;
    const abs = toAbs(s, base);
    const r = relOf(abs);
    if (r === null) return;
    if (kind === 'auto') {
      // Only cp/cpSync: Node 22 copies the tree internally, not through the patched fs reads (Node 20
      // lists directories through readdirSync, which adds a `d` record too), so a directory copy is a
      // content dependence on everything beneath it — a `d` listing alone would miss a modified file
      // inside the copied tree.
      const st = statSync(abs, { throwIfNoEntry: false });
      kind = st && st.isDirectory() ? 'c' : 'f';
    }
    emit(kind, r);
  }

  const CUSTOM = util.promisify.custom;
  // A wrapper that runs `before(arguments)` (guarded) and then the original, carrying the original's
  // own properties. A promisify.custom implementation calls the unwrapped original directly, so it is
  // replaced by a wrapped copy under the original's attributes — and left out of the bulk copy, since
  // Node defines it non-configurable (copied first, it could never be replaced).
  // A promisified function's own custom slot points at itself (Node sets it so promisify is idempotent):
  // that self-reference maps to the wrapper, and only the top level's custom implementation is wrapped.
  function wrapFn(orig, before, nested = false) {
    const wrapped = function traced() {
      try {
        before(arguments);
      } catch (_) {
        // never break the traced process
        failClosed();
      }
      return orig.apply(this, arguments);
    };
    const descriptors = Object.getOwnPropertyDescriptors(orig);
    const customDesc = descriptors[CUSTOM];
    delete descriptors[CUSTOM];
    try {
      Object.defineProperties(wrapped, descriptors);
    } catch (_) {
      // a non-configurable property: keep what was copied
    }
    if (customDesc) {
      let value = customDesc.value;
      if (value === orig) value = wrapped;
      else if (typeof value === 'function' && !nested) value = wrapFn(value, before, true);
      try {
        Object.defineProperty(wrapped, CUSTOM, { ...customDesc, value });
      } catch (_) {
        // an accessor: keep the original's
        try { Object.defineProperty(wrapped, CUSTOM, customDesc); } catch (__) { /* none */ }
      }
    }
    return wrapped;
  }
  // Each patch is installed on its own: one that fails (a frozen or non-writable target) fails closed
  // and leaves every other patch in place.
  function patch(obj, name, before) {
    try {
      if (!obj || typeof obj[name] !== 'function') return;
      const orig = obj[name];
      const wrapped = wrapFn(orig, before);
      if (typeof orig.native === 'function') wrapped.native = wrapFn(orig.native, before);
      obj[name] = wrapped;
      if (obj[name] !== wrapped) failClosed();
    } catch (_) {
      failClosed();
    }
  }
  const first = (kind) => (args) => record(kind, args[0]);

  const FS_KINDS = {
    f: ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'copyFileSync', 'copyFile',
      'statSync', 'stat', 'lstatSync', 'lstat'],
    s: ['existsSync', 'exists', 'accessSync', 'access', 'realpathSync', 'realpath', 'readlinkSync', 'readlink'],
    d: ['readdirSync', 'readdir', 'opendirSync', 'opendir'],
    auto: ['cpSync', 'cp'],
  };
  const PROMISE_KINDS = {
    f: ['readFile', 'open', 'copyFile', 'stat', 'lstat'],
    s: ['access', 'realpath', 'readlink'],
    d: ['readdir', 'opendir'],
    auto: ['cp'],
  };
  for (const [kind, names] of Object.entries(FS_KINDS)) for (const n of names) patch(fs, n, first(kind));
  for (const [kind, names] of Object.entries(PROMISE_KINDS)) for (const n of names) patch(fs.promises, n, first(kind));

  for (const ext of ['.js', '.json', '.cjs']) {
    patch(Module._extensions, ext, (args) => record('f', args[1]));
  }

  // The CJS resolver probes candidates through internal bindings, so an added `index.js` (or a `foo.js`
  // beside `foo/`) can change what a relative or absolute `require` resolves to without touching any
  // recorded read: each such request records `s` for its whole candidate set. Bare specifiers record nothing.
  const RESOLVE_EXTS = ['.js', '.json', '.cjs', '.node'];
  patch(Module, '_resolveFilename', (args) => {
    const request = args[0];
    if (typeof request !== 'string') return;
    let base;
    if (path.isAbsolute(request)) base = toAbs(request);
    else if (/^\.\.?(\/|\\|$)/.test(request)) {
      const parent = args[1];
      if (!parent || typeof parent.filename !== 'string' || !path.isAbsolute(parent.filename)) return;
      base = toAbs(request, path.dirname(parent.filename));
    } else return;
    if (!base) return;
    const candidates = [base, path.join(base, 'package.json')];
    for (const ext of RESOLVE_EXTS) candidates.push(base + ext, path.join(base, `index${ext}`));
    for (const c of candidates) {
      const r = relOf(c);
      if (r !== null) emit('s', r);
    }
  });

  // ---- child processes ----

  const REQ = process.env.CT_TRACE_REQUIRE || '';
  function injectEnv(env) {
    if (env.CT_TRACE_ROOT !== undefined && env.CT_TRACE_ROOT !== ROOT_ENV) return env;
    const next = { ...env, CT_TRACE_ROOT: ROOT_ENV, CT_TRACE_DIR: DIR_ENV, CT_TRACE_TEST: test };
    if (REQ) {
      next.CT_TRACE_REQUIRE = REQ;
      const opts = typeof next.NODE_OPTIONS === 'string' ? next.NODE_OPTIONS : '';
      if (!opts.includes(REQ)) next.NODE_OPTIONS = opts ? `${opts} ${REQ}` : REQ;
    }
    return next;
  }

  // Splits a shell command line into its simple commands' words: quotes and backslashes are honoured,
  // `| ; & ( )` and newlines end a command, and a redirection's target is dropped (it is not an argument).
  function shellCommands(str) {
    const cmds = [[]];
    let word = null;
    let skipNext = false;
    const endWord = () => {
      if (word === null) return;
      if (skipNext) skipNext = false;
      else cmds[cmds.length - 1].push(word);
      word = null;
    };
    for (let i = 0; i < str.length;) {
      const ch = str[i];
      if (ch === "'") {
        const end = str.indexOf("'", i + 1);
        const stop = end === -1 ? str.length : end;
        word = (word || '') + str.slice(i + 1, stop);
        i = stop + 1;
      } else if (ch === '"') {
        let j = i + 1;
        let s = '';
        while (j < str.length && str[j] !== '"') {
          if (str[j] === '\\' && j + 1 < str.length) { s += str[j + 1]; j += 2; } else s += str[j++];
        }
        word = (word || '') + s;
        i = j + 1;
      } else if (ch === '\\' && i + 1 < str.length) {
        word = (word || '') + str[i + 1];
        i += 2;
      } else if (ch === '\n' || ch === '|' || ch === ';' || ch === '&' || ch === '(' || ch === ')') {
        endWord();
        cmds.push([]);
        i++;
      } else if (/\s/.test(ch)) {
        endWord();
        i++;
      } else if (ch === '>' || ch === '<') {
        if (word !== null && /^\d+$/.test(word)) word = null;
        else endWord();
        i++;
        while (str[i] === '>' || str[i] === '&') i++;
        skipNext = true;
      } else {
        word = (word || '') + ch;
        i++;
      }
    }
    endWord();
    return cmds.filter((c) => c.length > 0);
  }

  const isNode = (cmd) => {
    const base = path.basename(cmd).toLowerCase();
    return cmd === process.execPath || base === 'node' || base === 'node.exe';
  };
  const isGit = (cmd) => {
    const base = path.basename(cmd).toLowerCase();
    return base === 'git' || base === 'git.exe';
  };
  const existing = (abs) => (abs === null ? null : statSync(abs, { throwIfNoEntry: false }) || null);

  // The git subcommands whose output depends on the content (or the listing) of tracked files — the
  // ones that are recorded as `c` prefixes. Writers and ref-only commands (add, commit, checkout,
  // rev-parse, ...) are absent on purpose: they do not make a test's result depend on a file's bytes.
  const GIT_CONTENT = new Set(['ls-files', 'grep', 'show', 'cat-file', 'ls-tree', 'archive', 'diff', 'log', 'status', 'blame']);
  const GIT_VALUE_OPTS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

  const GLOB_CHARS = /[*?[]/;
  // The repo top for `:/` and `top` pathspec magic: the realpath form when it differs from the given
  // one (`roots` pushes it last above), because git reports and resolves against the real path.
  const TOP = roots[roots.length - 1];

  // git's global options before the subcommand: { cwd (absolute; undefined = the process cwd), sub (the
  // subcommand's index) }, or null when a `-C` value cannot be resolved.
  function gitGlobals(args, base) {
    let cwd = base;
    let i = 0;
    for (; i < args.length; i++) {
      const t = args[i];
      if (t === '-C') {
        cwd = toAbs(args[++i], cwd);
        if (!cwd) return null;
      } else if (GIT_VALUE_OPTS.has(t)) i++;
      else if (!t.startsWith('-')) break;
    }
    return { cwd, sub: i };
  }

  // A pathspec token's magic split off: `:(top,glob,…)pattern` or the short `:/` `:!` `:^` forms.
  // `base` is the repo top under `top` magic (and for a bare `:path` before `--`, git's index-blob
  // form), else the git cwd; `glob` is false under `literal` magic.
  function parsePathspec(t, cwdAbs, pathsOnly) {
    let magic = [];
    let pattern = t;
    if (t.startsWith(':(')) {
      const end = t.indexOf(')');
      if (end !== -1) {
        magic = t.slice(2, end).split(',').map((m) => m.trim().replace(/:.*$/, ''));
        pattern = t.slice(end + 1);
      }
    } else if (t.startsWith(':')) {
      let k = 1;
      for (; k < t.length && '/!^'.includes(t[k]); k++) magic.push(t[k] === '/' ? 'top' : 'exclude');
      if (t[k] === ':') k++;
      pattern = t.slice(k);
      if (magic.length === 0 && !pathsOnly) magic.push('top');
    }
    return {
      pattern,
      base: magic.includes('top') ? TOP : cwdAbs,
      exclude: magic.includes('exclude'),
      icase: magic.includes('icase'),
      glob: !magic.includes('literal') && GLOB_CHARS.test(pattern),
    };
  }

  // A literal path argument of a git content command: records f/c when it exists in the repo (or, after
  // `--`, f even when it does not) and returns whether it counted.
  function recordGitPath(t, base, pathsOnly) {
    const abs = toAbs(t, base);
    const r = relOf(abs);
    if (r === null) return false;
    const st = existing(abs);
    if (!st && !pathsOnly) return false;
    emit(st && st.isDirectory() ? 'c' : 'f', r);
    return true;
  }

  // One `git grep` option token: whether it gives a pattern (-e/--regexp, or -f/--file a pattern file),
  // whether it is -f/--file, and its value — attached (`-ePAT`, `--regexp=PAT`), or the next token
  // (`takesNext`). A short cluster's first value-taking letter takes the rest of the cluster or, last,
  // the next token; -A -B -C -m and the matching long options take a value too, so it is never read
  // as the pattern or a path.
  const GREP_LONG_VALUE = new Set(['--regexp', '--file', '--max-depth', '--threads', '--context',
    '--after-context', '--before-context', '--max-count']);
  function grepOption(t) {
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq === -1 ? t : t.slice(0, eq);
      const pattern = name === '--regexp' || name === '--file';
      const file = name === '--file';
      if (eq !== -1) return { pattern, file, takesNext: false, value: t.slice(eq + 1) };
      return { pattern, file, takesNext: GREP_LONG_VALUE.has(name), value: undefined };
    }
    for (let k = 1; k < t.length; k++) {
      const ch = t[k];
      if (ch === 'O') break; // -O[<pager>]: the rest of the cluster is its optional value
      if ('efABCm'.includes(ch)) {
        const last = k === t.length - 1;
        return { pattern: ch === 'e' || ch === 'f', file: ch === 'f', takesNext: last, value: last ? undefined : t.slice(k + 1) };
      }
    }
    return { pattern: false, file: false, takesNext: false, value: undefined };
  }

  // The git rule: a content subcommand run inside the root records its in-repo path arguments (or
  // `<rev>:<path>` paths), else `c` for its cwd's prefix. Returns false when the rule does not apply.
  // A glob or magic pathspec records `c` for its literal directory prefix (the segments before the first
  // one holding a glob character); an exclusion pathspec counts as no path.
  function recordGit(args, g) {
    const i = g.sub;
    if (!GIT_CONTENT.has(args[i])) return false;
    const cwdAbs = g.cwd === undefined ? currentCwd() : g.cwd;
    const prefix = relOf(cwdAbs);
    if (prefix === null) return false;
    let found = false;
    let pathsOnly = false;
    const grep = args[i] === 'grep';
    let patternGiven = false;
    for (let j = i + 1; j < args.length; j++) {
      const t = args[j];
      if (t === '') continue;
      if (!pathsOnly && t === '--') { pathsOnly = true; continue; }
      if (grep && !pathsOnly && t.startsWith('-')) {
        const opt = grepOption(t);
        if (opt.pattern) patternGiven = true;
        // A `-f <file>` pattern file is a content read, but not a pathspec: it never narrows the prefix.
        const value = opt.takesNext ? args[++j] : opt.value;
        if (opt.file && typeof value === 'string') record('f', value, cwdAbs);
        continue;
      }
      if (!pathsOnly && t.startsWith('-')) continue;
      // `git grep`'s first positional is its pattern (a regex), unless -e/-f already gave one.
      if (grep && !pathsOnly && !patternGiven) {
        patternGiven = true;
        continue;
      }
      if (t.startsWith(':') || GLOB_CHARS.test(t)) {
        const spec = parsePathspec(t, cwdAbs, pathsOnly);
        if (spec.exclude) continue;
        if (!spec.glob) {
          if (recordGitPath(spec.pattern, spec.base, pathsOnly)) found = true;
          continue;
        }
        const segments = spec.pattern.split('/');
        const literal = spec.icase ? [] : segments.slice(0, segments.findIndex((s) => GLOB_CHARS.test(s)));
        const r = relOf(toAbs(literal.join('/'), spec.base));
        if (r !== null) {
          emit('c', r);
          found = true;
        }
        continue;
      }
      if (recordGitPath(t, cwdAbs, pathsOnly)) {
        found = true;
        continue;
      }
      const colon = pathsOnly ? -1 : t.indexOf(':');
      if (colon === -1 || colon === t.length - 1) continue;
      // `<rev>:<path>` is relative to the repo top unless it starts with ./ or ../ — counted only when it
      // exists now, so an option value that merely holds a colon never hides the cwd-wide prefix.
      const p = t.slice(colon + 1);
      const pAbs = /^\.\.?[\\/]/.test(p) ? toAbs(p, cwdAbs) : toAbs(p, TOP);
      const pr = relOf(pAbs);
      const pst = pr === null ? null : existing(pAbs);
      if (pst) {
        emit(pst.isDirectory() ? 'c' : 'f', pr);
        found = true;
      }
    }
    if (!found) emit('c', prefix);
    return true;
  }

  const isShell = (cmd) => ['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(path.basename(cmd).toLowerCase());
  // The script of `sh [-opts] -c "<script>"` (a flag cluster holding `c` takes it), or null.
  function shellScript(words) {
    for (let j = 1; j < words.length; j++) {
      const t = words[j];
      if (!t.startsWith('-') || t === '--' || t === '-') return null;
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) return j + 1 < words.length ? words[j + 1] : null;
    }
    return null;
  }

  // One child command (its words) run from `base` (absolute; undefined = the process cwd). Leading
  // `NAME=value` assignments are skipped; `sh -c "<script>"` is read as the shell string it runs; a git
  // command the git rule does not cover falls through with its global options and their values dropped.
  function recordCommand(commandWords, base) {
    let words = commandWords;
    let first = 0;
    while (first < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first])) first++;
    if (first === words.length) return;
    if (first) words = words.slice(first);
    const cmd = words[0];
    if (isNode(cmd)) return;
    if (isShell(cmd)) {
      const script = shellScript(words);
      if (script !== null) {
        for (const c of shellCommands(script)) recordCommand(c, base);
        return;
      }
    }
    if (isGit(cmd)) {
      const args = words.slice(1);
      const g = gitGlobals(args, base);
      if (!g) return;
      if (recordGit(args, g)) return;
      words = args.slice(g.sub);
      base = g.cwd;
    }
    for (let k = 0; k < words.length; k++) {
      const t = words[k];
      if (t === '' || t.startsWith('-')) continue;
      if (k === 0 && !t.includes('/') && !t.includes('\\')) continue;
      const abs = toAbs(t, base);
      const r = relOf(abs);
      if (r === null) continue;
      const st = existing(abs);
      if (st) emit(st.isDirectory() ? 'c' : 'f', r);
    }
  }

  const optionsIndex = (args) => {
    for (let k = 1; k < args.length; k++) {
      const v = args[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) return k;
    }
    return -1;
  };

  // An option as child_process reads it: Node copies only the options object's own enumerable properties.
  const own = (opts, key) => (opts && Object.prototype.propertyIsEnumerable.call(opts, key) ? opts[key] : undefined);

  function beforeChild(name) {
    return (args) => {
      const k = optionsIndex(args);
      const opts = k === -1 ? null : args[k];
      const env = own(opts, 'env');
      if (env && typeof env === 'object') {
        args[k] = Object.assign(Object.create(Object.getPrototypeOf(opts)), opts, { env: injectEnv(env) });
      }
      if (name === 'fork') return;
      let base;
      const cwd = own(opts, 'cwd');
      if (cwd != null) {
        base = toAbs(toPathString(cwd), undefined);
        if (!base) return;
      }
      let commands;
      if (name === 'exec' || name === 'execSync') commands = shellCommands(String(args[0]));
      else {
        const words = [String(args[0])].concat(Array.isArray(args[1]) ? args[1].map(String) : []);
        commands = own(opts, 'shell') ? shellCommands(words.join(' ')) : [words];
      }
      for (const words of commands) recordCommand(words, base);
    };
  }
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    patch(cp, name, beforeChild(name));
  }

  try {
    Module.syncBuiltinESMExports();
  } catch (_) {
    // ESM named imports would keep the unwrapped functions
    failClosed();
  }
}
