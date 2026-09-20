// bin/lib/hooks/git-command.js
'use strict';
const path = require('path');

// Quote-aware top-level split: a single pass tracks single/double-quote state
// and only cuts at separators (&&, ||, ;, |, newline) that are outside any
// quote span. Newline is a segment boundary because gitTargets only ever
// inspects t[0] of each segment to detect a `cd`/`git` command — a bare
// newline (not `&&`/`;`) between two statements otherwise merges them into
// one segment, silently hiding a `cd` that isn't the segment's first token
// (e.g. `VAR="x"\ncd "$VAR" && git commit` — the `cd` never gets seen, so
// the effective cwd used for the commit target stays whatever it was before
// this segment, not where the command will actually run).
// This protects the safety invariant — ambiguity resolves to allow — by
// preventing quoted text (e.g. a commit message containing "&& git -C /x push")
// from being misparsed as additional shell segments that fabricate a target.
function splitSegments(command) {
  const str = String(command || '');
  const segments = [];
  let current = '';
  let quote = null; // null | '"' | "'"
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote === "'") {
      // Inside single quotes, backslash has no special meaning in bash.
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    // Not inside single quotes (unquoted or inside double quotes): a
    // backslash escapes the next character, so `\"` never toggles quote
    // state and `\\` is a literal backslash — matching bash semantics.
    if (ch === '\\' && i + 1 < str.length) {
      current += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && str[i + 1] === '&') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === '|' && str[i + 1] === '|') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === ';' || ch === '|' || ch === '\n') { segments.push(current); current = ''; continue; }
    // Unquoted `#` at the start of a word begins a bash comment that runs to
    // the end of the line — real bash never executes anything after it, so
    // any &&/;/| inside it must not fabricate a segment boundary. Only
    // recognized at a word boundary (start of string, or immediately after
    // whitespace/a separator) to match bash's own rule: `#` glued to
    // preceding non-whitespace text (e.g. `foo#bar`) is NOT a comment.
    if (ch === '#' && (i === 0 || /[\s;&|]/.test(str[i - 1]))) {
      let j = i + 1;
      while (j < str.length && str[j] !== '\n') j++;
      i = j - 1; // for-loop's i++ lands exactly on the newline (or end of string)
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

// Tokenizer that keeps quoted spans (with spaces) as one token. Also merges a
// quoted span into an immediately-adjacent (no whitespace between) match —
// matching real shell word-splitting, where `"/tmp/safe/"$SUFFIX` is ONE word
// (`/tmp/safe/<value-of-$SUFFIX>`), not two. Without this, resolveCd/isUnresolvable
// only ever see the quoted portion in isolation, judge it fully resolvable, and
// silently drop the unresolvable suffix that would otherwise poison the target.
//
// Returns `{ tokens, singleQuoted }` — `singleQuoted[i]` is true when any part
// of `tokens[i]` was assembled from a single-quoted span. Real bash never
// performs `$`-expansion inside single quotes (unlike double quotes or bare
// words), so this flag is what lets substituteVars() below refuse to treat a
// single-quoted `'$NAME'` as a variable reference — without it, a token like
// `'$WT/a.js'` and `"$WT/a.js"` are indistinguishable post-tokenize, and the
// substitution step would wrongly expand the single-quoted (never-expanded)
// form, fabricating a target real bash would never produce for that command.
function tokenize(seg) {
  const out = [];
  const singleQuoted = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  let prevEnd = -1;
  while ((m = re.exec(seg)) !== null) {
    const val = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    const isSQ = m[2] !== undefined;
    if (out.length && m.index === prevEnd) {
      out[out.length - 1] += val;
      if (isSQ) singleQuoted[singleQuoted.length - 1] = true;
    } else {
      out.push(val);
      singleQuoted.push(isSQ);
    }
    prevEnd = re.lastIndex;
  }
  return { tokens: out, singleQuoted };
}

// Global git flags that consume the NEXT token as a value.
const VALUE_FLAGS = new Set(['-C', '-c', '--exec-path', '--namespace']);
// Flags that make the target unprovable from the command text alone.
const UNPROVABLE_FLAGS = ['--git-dir', '--work-tree'];

// A raw (unquote-stripped) cd/-C argument that is unresolvable to a concrete,
// literal path: no argument, "-", starts with "~", contains "$"/backtick, or
// contains a backslash/double-quote. The last two guard against token-level
// ambiguity: the regex tokenizer below is not escape-aware, so a value that
// still carries a backslash or stray quote (from an escaped-quote sequence
// upstream) cannot be trusted as a literal path — never claim an unprovable
// target. Also unresolvable: anything else that looks like a FLAG (starts
// with "-", length > 1) — cd's own flags (-L, -P, -e, -@, --) are not path
// arguments; without this, `cd -P /other-repo` would resolve "-P" itself as
// a literal (almost certainly nonexistent) child directory of the current
// cwd instead of recognizing the real target is unprovable from here.
function isUnresolvable(raw) {
  return (
    raw === undefined ||
    raw === '-' ||
    (raw.length > 1 && raw.startsWith('-')) ||
    raw.startsWith('~') ||
    raw.includes('$') ||
    raw.includes('`') ||
    raw.includes('\\') ||
    raw.includes('"')
  );
}

function isAbsolutePlain(raw) {
  return !isUnresolvable(raw) && path.isAbsolute(raw);
}

// Shared cd-token resolution used by both gitTargets and fileWriteTargets: given
// the current effective cwd (string, or null meaning UNKNOWN) and a `cd`
// command's raw (unquote-stripped) argument, returns the new effective cwd (or
// null when the argument leaves it unprovable). Kept as one function so a
// future fix to cd-resolution edge cases (a new isUnresolvable pattern,
// pushd/popd support, etc.) can never land in one caller and not the other.
function resolveCd(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  if (effCwd === null) {
    // Unknown cwd: only a plain absolute path restores provability.
    return isAbsolutePlain(raw) ? path.resolve(raw) : null;
  }
  return path.resolve(effCwd, stripQuotes(raw));
}

// Matches a segment that is exactly one token shaped like a simple literal
// variable assignment: NAME=value / NAME="value" / NAME='value' (bash
// permits no space around `=`, and this regex requires no space inside the
// value either — a value containing an unescaped space tokenizes into more
// than one token, which the length check in updateAssignment below excludes;
// that's an accepted narrowing, not a bug). No `export`, no arrays:
// `export SP=/x` tokenizes to two tokens (`export`, `SP=/x`) and fails the
// length check before this regex ever runs, so `export` needs no separate
// rejection.
const SIMPLE_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// Classifies raw (pre-substitution) token array `t` as a simple same-command
// assignment and updates `vars` in place; returns whether it was one (the
// caller `continue`s past handler/cd on true, the same way an existing `cd`
// segment already does). A later assignment of the same name overwrites the
// earlier one; an assignment whose OWN value is unresolvable DELETES any
// earlier mapping for that name rather than leaving it in place — the
// variable's value genuinely changed, so continuing to substitute the stale
// earlier value would itself be a fabricated-target risk, the exact thing
// this module's fail-open posture exists to avoid. Deliberately reads the
// RAW (pre-substitution) token, never the substituted one — this is what
// keeps a chained reference (`B=$A/y`) from ever resolving through a second
// hop: `$A/y`'s raw value still contains `$`, so isUnresolvable rejects it
// here, before substitution would otherwise have had a chance to touch it.
function updateAssignment(vars, t) {
  if (t.length !== 1) return false;
  const m = SIMPLE_ASSIGNMENT_RE.exec(t[0]);
  if (!m) return false;
  const [, name, rawValue] = m;
  const value = stripQuotes(rawValue);
  if (isUnresolvable(value)) vars.delete(name);
  else vars.set(name, value);
  return true;
}

// Matches a token's $NAME / ${NAME} reference.
const VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

// Substitutes a same-command literal assignment into a token, deliberately
// narrow: only a token whose $/backtick content is EXACTLY one $NAME or
// ${NAME} reference to an already-tracked name is rewritten; anything else
// (an unassigned name, a second $ or a backtick elsewhere in the token) is
// returned unchanged and falls through to the existing
// isUnresolvable()/null-target behavior unmodified. Never recursive — the
// substituted value is a literal already proven not to contain `$` (by
// updateAssignment's own isUnresolvable check at assignment time), so there
// is nothing left to re-scan.
function substituteVars(tokens, vars, singleQuoted) {
  if (!vars.size) return tokens;
  return tokens.map((tok, i) => {
    // Real bash never expands `$NAME` inside single quotes — a token built
    // from a single-quoted span is never a variable reference, regardless of
    // its text. Skip it untouched; it falls through to the existing
    // isUnresolvable()/null-target behavior unmodified (see tokenize()'s
    // singleQuoted comment for why this guard exists).
    if (singleQuoted && singleQuoted[i]) return tok;
    if (!tok.includes('$') || tok.includes('`')) return tok;
    const matches = [...tok.matchAll(VAR_REF_RE)];
    if (matches.length !== 1) return tok;
    if ((tok.match(/\$/g) || []).length !== 1) return tok;
    const m = matches[0];
    const name = m[1] || m[2];
    if (!vars.has(name)) return tok;
    return tok.slice(0, m.index) + vars.get(name) + tok.slice(m.index + m[0].length);
  });
}

// Shared segment/token walk used by both gitTargets and fileWriteTargets:
// splits the command into shell segments, tokenizes each, and tracks `cd` to
// keep the effective cwd in sync. `handler(t, effCwd)` is invoked for every
// non-cd, non-empty segment with the cwd value in effect for it (string, or
// null meaning UNKNOWN). Also tracks same-command literal `NAME=value`
// assignments (see updateAssignment/substituteVars above) and substitutes
// them into every other segment's tokens before `handler`/the `cd` branch
// sees them — one shared point so a future fix to either cd-resolution or
// assignment-substitution can never land in one caller's copy of this
// preamble and not the other's.
function forEachCommandSegment(command, cwd, handler) {
  let effCwd = cwd || '.'; // string, or null meaning UNKNOWN
  const vars = new Map(); // name -> literal value, same-command only, no chaining
  for (const seg of splitSegments(command)) {
    const { tokens: rawT, singleQuoted } = tokenize(seg.trim());
    if (!rawT.length) continue;
    if (updateAssignment(vars, rawT)) continue;
    const t = substituteVars(rawT, vars, singleQuoted);
    // `FOO=1 cd /path` really does change the shell's cwd — a preceding
    // assignment on a regular (non-special) builtin like `cd` is scoped only
    // to that command's own execution environment, but `cd` has no
    // subprocess to scope the env change to, so it still runs and changes
    // the CURRENT shell's cwd (verified empirically; #590). `env cd /path`
    // is the opposite case and deliberately NOT normalized here: `env` execs
    // an external `cd` binary that does not exist on a normal system, so it
    // errors and never changes cwd — normalizing it would fabricate a target
    // for a shape that has no real effect.
    let cdLead = 0;
    while (cdLead < t.length && SIMPLE_ASSIGNMENT_RE.test(t[cdLead])) cdLead += 1;
    if (t[cdLead] === 'cd') {
      effCwd = resolveCd(effCwd, t[cdLead + 1]);
      continue;
    }
    handler(t, effCwd);
  }
}

// Consumes every leading global git flag (-C <dir>, -c <k>=<v>, --exec-path,
// --namespace, --git-dir, --work-tree, and any other unrecognized `-...`
// flag) starting at token index `i`, resolving -C against `dir` the same way
// gitTargets always has. Returns the index of the first non-flag token (the
// subcommand), the resolved dir (or null if UNKNOWN), and whether the
// target became unprovable. Shared by gitTargets and teardownTargets so a
// future global-flag fix lands once for both instead of drifting between two
// hand-kept copies — teardownTargets used to check only a literal `-C`
// immediately after `git`, so any other global flag (`-c ...`, `--no-pager`,
// etc.) ahead of `worktree remove` defeated its parser entirely and silently
// allowed tearing down a worktree still assigned to a non-terminal run.
function skipGlobalFlags(t, i, dir) {
  let unprovable = false;
  while (i < t.length && t[i].startsWith('-')) {
    const flag = t[i];
    if (UNPROVABLE_FLAGS.some((u) => flag === u || flag.startsWith(u + '='))) { unprovable = true; i += flag.includes('=') ? 1 : 2; continue; }
    // Use an explicit index-bound check (i + 1 < t.length), not a truthy
    // check on t[i + 1] — a truthy check treats a genuinely-present but
    // EMPTY value (`-C ""`, which real git treats as equivalent to
    // omitting -C entirely) as "no value follows", mis-consuming only the
    // flag token and leaving the leftover '' to be misread as the git
    // subcommand two lines below.
    if (flag === '-C' && i + 1 < t.length) {
      const raw = t[i + 1];
      if (isUnresolvable(raw)) {
        unprovable = true;
      } else if (path.isAbsolute(raw)) {
        dir = path.resolve(raw);
      } else if (dir === null) {
        // Relative -C while cwd is UNKNOWN — cannot prove the target.
        unprovable = true;
      } else {
        dir = path.resolve(dir, raw);
      }
      i += 2;
      continue;
    }
    if (VALUE_FLAGS.has(flag) && i + 1 < t.length) { i += 2; continue; }
    i += 1;
  }
  return { index: i, dir, unprovable };
}

// Finds the real `git` command word in a segment's raw token array, looking
// past three equivalent shapes a real shell treats identically to a bare
// `git` invocation (#590):
//   - leading `NAME=value` assignment tokens: `FOO=1 git commit -m x`
//   - the `env` builtin, plus ITS OWN leading flags/assignments, ahead of the
//     real command: `env git commit -m x`, `env -i git commit -m x`,
//     `env FOO=1 git commit -m x`
//   - a directory-qualified executable ending in `/git`: `/usr/bin/git commit`
// (any combination of the three also resolves, e.g. `FOO=1 /usr/bin/git …`
// or `env FOO=1 /usr/bin/git …`.)
//
// Returns `{ index, dir, unprovable }` — `index` is -1 when, after
// normalization, the leading token still isn't `git` (ambiguity resolves to
// "not git", the same never-fabricate-a-target posture as the rest of this
// module). `dir` starts at the caller's effective cwd and moves when env's
// own `-C <dir>` / `--chdir[=]<dir>` flag changes where the command runs —
// skipping those flags without consuming their value made
// `env -C <main-checkout> git commit` read as not-git at all (the dir token
// became the presumed lead) and `env --chdir=/x git commit` resolve its
// target against the wrong directory. `-u`/`--unset <name>` likewise
// consumes its value so the name is never mistaken for the command word.
// Still not full env(1) parsing (see #590's Gotchas): `-S`/`--split-string`
// re-splits an opaque program string, which is statically unknowable — the
// same deliberately-uncovered class as `sh -c`/`python -c` (see
// fileWriteTargets' header) — so it falls through to the not-git default.
function findGitLead(t, dir) {
  let unprovable = false;
  let i = 0;
  while (i < t.length && SIMPLE_ASSIGNMENT_RE.test(t[i])) i += 1;
  if (t[i] === 'env') {
    i += 1;
    while (i < t.length) {
      const tok = t[i];
      if (SIMPLE_ASSIGNMENT_RE.test(tok)) { i += 1; continue; }
      if (tok === '-' || !tok.startsWith('-')) break;
      // Both spellings env accepts: separate value (`-C <dir>`, `--chdir <dir>`)
      // and attached value (`-C<dir>`, `--chdir=<dir>`). Skipping the attached
      // short form as a generic flag left the resolved dir at the caller's cwd
      // while git was still detected as lead — the same silent-allow bypass as
      // the separate form, one spelling over.
      if (tok === '-C' || tok === '--chdir' || tok.startsWith('--chdir=') || (tok.startsWith('-C') && tok.length > 2)) {
        const attached = tok.startsWith('--chdir=') ? tok.slice('--chdir='.length)
          : tok.startsWith('-C') && tok.length > 2 ? tok.slice(2)
          : null;
        const raw = attached !== null ? attached : t[i + 1];
        const resolved = resolveCd(dir, raw);
        if (resolved === null) unprovable = true;
        else dir = resolved;
        i += attached !== null ? 1 : 2;
        continue;
      }
      if (tok === '-u' || tok === '--unset') { i += 2; continue; }
      i += 1;
    }
  }
  if (i >= t.length) return { index: -1, dir, unprovable };
  const lead = t[i];
  if (lead === 'git' || lead.endsWith('/git')) return { index: i, dir, unprovable };
  return { index: -1, dir, unprovable };
}

// Shared findGitLead -> skipGlobalFlags preamble: resolves one command
// segment's real git lead and the subcommand position/dir past any global
// flags, in the one index/unprovable/dir-null check sequence both gitTargets
// and teardownTargets (pre-tool-use.js) need. Returns `{ index, dir }` (index
// is the resolved SUBCOMMAND token position) or null when the segment isn't
// git, or the target is unprovable / cwd-unknown-with-no-provable--C. A
// single shared point so a future fix to this preamble lands once for both
// callers instead of drifting between two hand-kept copies — the exact gap
// #1308 closed for teardownTargets, which used to skip this preamble
// entirely and check a bare `toks[0] !== 'git'` instead.
function resolveGitCommand(t, effCwd) {
  const lead = findGitLead(t, effCwd);
  if (lead.index === -1) return null;
  const { index, dir, unprovable } = skipGlobalFlags(t, lead.index + 1, lead.dir);
  if (lead.unprovable || unprovable || dir === null) return null;
  return { index, dir };
}

// #976 (IL-141): git-plumbing subcommands that mutate tracked state or refs
// OUTSIDE the commit/push pair gitTargets already classified — every one of
// these previously bypassed E1/worktree-always/pipeline-shadow enforcement
// entirely, since an unrecognized `sub` never became a target at all.
// Evidence-driven, deliberately narrow (see the Gotchas this closes): each
// entry is a subcommand that is UNAMBIGUOUSLY a write in every ordinary
// invocation, not merely capable of one under some flag combination.
//   - `mv`         — renames/moves a tracked file (index + working tree).
//   - `rm`          — removes a tracked file from the index (working tree
//                     too, unless `--cached`) — always a mutation, with or
//                     without `--cached`.
//   - `update-ref`  — directly rewrites a ref (a branch pointer) — pure
//                     plumbing, no read-only form.
//   - `apply`       — applies a patch to the working tree/index.
// Deliberately NOT included in this pass: `stash`, `reset`, `checkout`,
// `switch`, `restore`, `merge`, `rebase`, `cherry-pick`. Each has a common,
// genuinely read-only or non-mutating invocation shape (`stash list`/`show`,
// `reset` with no path args just moves HEAD's *reflog* pointer inside the
// SAME worktree it's run in and is routinely run from a script for its exit
// code alone, `checkout <branch>` with no path args, etc.) that a one-level
// subcommand check cannot distinguish from the mutating form without
// resolving a second token — the exact "pattern-matching every git
// subcommand indiscriminately" this record's own Gotchas warns against.
// Extend evidence-driven, on a real incident, not speculatively.
const PLUMBING_WRITE_SUBCOMMANDS = new Set(['mv', 'rm', 'update-ref', 'apply']);

// #2065: one shared traversal for every consumer that needs "every git
// invocation in this command, resolved" — checkGitStashWarn and gitTargets
// used to each run their own forEachCommandSegment + resolveGitCommand walk
// over the identical command/cwd, a second full quote-aware parse on the hot
// path (every Bash tool call, every session). This is the one walk; classification
// over its result (gitTargetsFrom below) is what tells "commit"/"push"/plumbing
// apart from "stash" apart from everything else — the traversal itself stays
// ignorant of which subcommand pre-tool-use.js's callers each care about.
function resolvedGitSegments(command, cwd) {
  const segments = [];
  forEachCommandSegment(command, cwd, (t, effCwd) => {
    const resolved = resolveGitCommand(t, effCwd);
    if (!resolved) return;
    segments.push({ tokens: t, index: resolved.index, dir: resolved.dir });
  });
  return segments;
}

// Pure classification over an already-resolved segment list — no traversal of
// its own. `gitTargets` below is the convenience wrapper kept for every
// existing caller (post-tool-use.js, tests) that still wants "parse and
// classify" in one call.
function gitTargetsFrom(segments) {
  const targets = [];
  for (const { tokens: t, index, dir } of segments) {
    const sub = t[index];
    if (sub === 'commit' || sub === 'push' || PLUMBING_WRITE_SUBCOMMANDS.has(sub)) {
      targets.push({ action: sub, dir });
    }
  }
  return targets;
}

function gitTargets(command, cwd) {
  return gitTargetsFrom(resolvedGitSegments(command, cwd));
}

// Best-effort detection of non-git, non-Edit/Write direct file-write shapes in
// a Bash command. Every shape here is one hooks.json can ALSO gate structurally
// via an if-matcher (`Bash(cp *)`, `Bash(sed *)`, ...) — that pairing is the
// whole design constraint. A branch here without a matcher there is dead code,
// because the hook process never spawns; that asymmetry is exactly what let
// `sed -i` bypass the gate silently for months (#70). The test in
// tests/hooks-gate-coverage.test.js now asserts the two lists agree.
//
// Still NOT covered, and deliberately (see the coverage block in
// skills/_shared/policy-schema.md for the measured rationale):
//   - bare shell redirection (`>`, `>>`) — no command word for an if-matcher to
//     recognize, so catching it means firing the hook on EVERY Bash call.
//     Measured at 42 ms idle / 68 ms under three-way contention per call.
//   - `python -c`, `sh -c`, `awk` program strings — the write target lives
//     inside an opaque program and is not statically knowable at any cost.
//
// Ambiguity resolves to "no target" (allow), matching gitTargets' own safety
// posture: never fabricate a target from a path this can't prove.
const DEVNULL_LIKE = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

function resolveWriteTarget(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  const stripped = stripQuotes(raw);
  // An explicitly-empty token is never a file. It reaches here as BSD sed's
  // separate backup suffix (`sed -i '' ...`); without this it would resolve to
  // effCwd itself and flag the whole directory as a write target.
  if (stripped === '') return null;
  if (DEVNULL_LIKE.has(stripped)) return null;
  if (path.isAbsolute(stripped)) return path.resolve(stripped);
  if (effCwd === null) return null; // cwd UNKNOWN and a relative path — not provable
  return path.resolve(effCwd, stripped);
}

// Split a shape's argument list into positionals and the flags seen, given the
// flags that consume the FOLLOWING token as their value. Long `--flag=value`
// forms are self-contained and never consume the next token. `--` ends option
// parsing, as it does for every one of these commands.
function partitionArgs(rest, valueFlags) {
  const positionals = [];
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { positionals.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      flags.push(a);
      if (valueFlags.has(a) && i + 1 < rest.length) i += 1;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags };
}

// Does this flag list request an in-place edit? Without one, sed and perl only
// read, and a read of the main checkout must stay allowed — so this gate is
// what keeps the shape from denying ordinary inspection commands.
//
// Detection can't just look for a literal `-i`: GNU attaches the backup suffix
// (`-i.bak`), and short flags bundle (`perl -pi -e`, `sed -ni`).
function hasInPlaceFlag(flags) {
  return flags.some((f) => {
    if (f === '--in-place' || f.startsWith('--in-place=')) return true;
    if (f.startsWith('--') || !f.startsWith('-')) return false;
    if (f.startsWith('-I')) return false; // perl's include path — not in-place
    if (f.startsWith('-i')) return true; // -i, -i.bak
    return /^-[A-Za-z]+$/.test(f) && f.includes('i'); // bundled: -pi, -ni
  });
}

// The Bash write shapes this function recognizes. Load-bearing, not
// descriptive: the guard below drops any segment whose command word is absent
// here, so adding a branch without adding its name makes that branch dead
// code. pre-tool-use.js's GATE_COVERAGE re-exports this list, and
// tests/hooks-gate-coverage.test.js pins it to the prose in
// skills/_shared/policy-schema.md — so widening this array is what forces the
// documentation to be updated (#138).
const WRITE_SHAPES = Object.freeze(['cp', 'mv', 'tee', 'sed', 'perl', 'install', 'ln', 'truncate', 'dd']);

// Per-shape value-consuming flags. Wrong entries here shift which token is read
// as a positional, so each is taken from the command's own documented options
// rather than guessed.
const SED_VALUE_FLAGS = new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']);
const PERL_VALUE_FLAGS = new Set(['-e', '-E', '-I', '-m', '-M', '-F', '-x']);
const INSTALL_VALUE_FLAGS = new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-t', '--target-directory', '-S', '--suffix']);
const LN_VALUE_FLAGS = new Set(['-t', '--target-directory', '-S', '--suffix']);
const TRUNCATE_VALUE_FLAGS = new Set(['-s', '--size', '-r', '--reference', '-o', '--io-blocks']);

// `-t DIR` / `--target-directory[=]DIR` names the destination explicitly, which
// makes EVERY positional a source rather than the last one being the target.
// Shared by cp/mv/install/ln, all of which accept it.
function explicitTargetDir(rest) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if ((a === '-t' || a === '--target-directory') && i + 1 < rest.length) return rest[i + 1];
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
  }
  return null;
}

// sed and perl share a program/file split: with -e/-f supplying the program,
// EVERY positional is a file; without one, the FIRST positional IS the program
// and only the rest are files.
function inPlaceEditTargets(rest, valueFlags, scriptFlags) {
  const { positionals, flags } = partitionArgs(rest, valueFlags);
  if (!hasInPlaceFlag(flags)) return []; // read-only invocation — nothing written
  const programSupplied = flags.some((f) => scriptFlags.some((s) => f === s || f.startsWith(`${s}=`)));
  return programSupplied ? positionals : positionals.slice(1);
}

function fileWriteTargets(command, cwd) {
  const targets = [];
  forEachCommandSegment(command, cwd, (t, effCwd) => {
    if (!WRITE_SHAPES.includes(t[0])) return;
    if (t[0] === 'tee') {
      // tee genuinely writes to EVERY non-flag argument, not just the
      // first — `tee a.txt b.txt` writes both files. .find() silently
      // dropped every destination after the first.
      for (const arg of t.slice(1).filter((a) => !a.startsWith('-'))) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }

    if (t[0] === 'cp' || t[0] === 'mv') {
      // `-t DIR` / `--target-directory[=]DIR` names the real destination
      // directory explicitly; every remaining positional argument is a
      // SOURCE, not the destination — the plain "last positional arg is
      // the destination" rule below only applies when neither form is
      // present.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const nonFlags = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-t' || a === '--target-directory') { i += 1; continue; }
        if (a.startsWith('-')) continue; // other flags — never a positional
        nonFlags.push(a);
      }
      const action = t[0] === 'cp' ? 'copy' : 'move';
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action, file });
      } else if (nonFlags.length >= 2) {
        const file = resolveWriteTarget(effCwd, nonFlags[nonFlags.length - 1]);
        if (file) targets.push({ action, file });
      }
      return;
    }

    if (t[0] === 'sed' || t[0] === 'perl') {
      // Only an in-place edit writes; a plain `sed -n .. file` is a read and
      // must stay allowed even in the main checkout.
      const isSed = t[0] === 'sed';
      const raw = inPlaceEditTargets(
        t.slice(1),
        isSed ? SED_VALUE_FLAGS : PERL_VALUE_FLAGS,
        isSed ? ['-e', '-f', '--expression', '--file'] : ['-e', '-E'],
      );
      for (const arg of raw) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'edit', file });
      }
      return;
    }

    if (t[0] === 'install') {
      // Same source→dest shape as cp, plus `-d`, under which EVERY positional
      // is a directory being created rather than a source.
      const rest = t.slice(1);
      const { positionals, flags } = partitionArgs(rest, INSTALL_VALUE_FLAGS);
      const targetDirRaw = explicitTargetDir(rest);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'install', file });
        return;
      }
      const creatingDirs = flags.some((f) => (
        f === '-d' || f === '--directory' || (/^-[A-Za-z]+$/.test(f) && f.includes('d'))
      ));
      // `-d`: every positional is a directory being created. Otherwise the
      // last positional is the destination and needs a source before it.
      let written = [];
      if (creatingDirs) written = positionals;
      else if (positionals.length >= 2) written = positionals.slice(-1);
      for (const arg of written) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'install', file });
      }
      return;
    }

    if (t[0] === 'ln') {
      // The LINK name is what gets created — the last positional. With a single
      // positional the link lands in the cwd under the source's basename.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const { positionals } = partitionArgs(rest, LN_VALUE_FLAGS);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'link', file });
        return;
      }
      if (positionals.length >= 2) {
        const file = resolveWriteTarget(effCwd, positionals[positionals.length - 1]);
        if (file) targets.push({ action: 'link', file });
      } else if (positionals.length === 1) {
        const file = resolveWriteTarget(effCwd, path.basename(stripQuotes(positionals[0])));
        if (file) targets.push({ action: 'link', file });
      }
      return;
    }

    if (t[0] === 'truncate') {
      // Every positional is truncated — and truncation CREATES the file when it
      // does not exist, so this writes regardless of `-c`.
      const { positionals } = partitionArgs(t.slice(1), TRUNCATE_VALUE_FLAGS);
      for (const arg of positionals) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'truncate', file });
      }
      return;
    }

    if (t[0] === 'dd') {
      // dd takes keyword arguments, not flags: the destination is `of=`.
      for (const arg of t.slice(1)) {
        const bare = stripQuotes(arg);
        if (!bare.startsWith('of=')) continue;
        const file = resolveWriteTarget(effCwd, bare.slice('of='.length));
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }
  });
  return targets;
}

// mkdir target parser — deliberately separate from WRITE_SHAPES/fileWriteTargets
// (#692): WRITE_SHAPES feeds the worktree-always Bash-write gate's coverage,
// which tests/hooks-gate-coverage.test.js pins to skills/_shared/policy-schema.md's
// prose; folding mkdir in there would widen that unrelated gate as a side effect.
// The pipeline-shadow guard (pre-tool-use.js) is this function's only consumer.
// mkdir takes no flag that both consumes a value AND could plausibly be confused
// with a positional except -m/--mode; every other positional is a target — mkdir
// can create several directories in one invocation.
const MKDIR_VALUE_FLAGS = new Set(['-m', '--mode']);
function mkdirTargets(command, cwd) {
  const targets = [];
  forEachCommandSegment(command, cwd, (t, effCwd) => {
    if (t[0] !== 'mkdir') return;
    const { positionals } = partitionArgs(t.slice(1), MKDIR_VALUE_FLAGS);
    for (const arg of positionals) {
      const file = resolveWriteTarget(effCwd, arg);
      if (file) targets.push({ action: 'mkdir', file });
    }
  });
  return targets;
}

module.exports = {
  gitTargets, gitTargetsFrom, resolvedGitSegments, fileWriteTargets, mkdirTargets, splitSegments, tokenize, forEachCommandSegment, skipGlobalFlags, findGitLead, resolveGitCommand, WRITE_SHAPES,
};
