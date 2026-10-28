// bin/lib/hooks/bash-prefilter.js — the "is this Bash call interesting?"
// decision, made BEFORE bin/hooks.js loads any of its heavy modules (#3074).
//
// hooks/hooks.json used to register the same `hooks.js pre-tool-use` command
// 28 times (and post-tool-use 18 times), each behind its own `if` predicate.
// When Claude Code cannot evaluate those predicates statically — any `$VAR`
// expansion, any for/while loop — it runs every one of them and does not
// deduplicate identical commands, so one Bash call launched the hook 46
// times. hooks.json now registers one unconditional handler per event, and
// this module is the filter the predicates used to be.
//
// It must stay a SUPERSET of those predicates: a false "skip" silently drops
// enforcement, a false "run" costs only the full handler's module load. So it
// scans the WHOLE command for a covered word in any position (Claude Code's
// own matcher also split compound commands and stripped `NAME=value`
// prefixes), takes path basenames (`/usr/bin/git`, `git.exe`), and resolves
// anything it cannot read to "run". It deliberately does not parse quoting —
// `echo "git"` running the full handler is an accepted false positive.
//
// It reads every word and every assignment value, so `G=git; $G push` is
// reached, and any command holding both an assignment and a `$NAME` reference
// runs the full handler, which covers a program name concatenated from pieces
// (`G=gi; ${G}t push`, `X=it; g$X commit`) — substituteVars resolves those.
// Known limit: a program name produced by command substitution (`$(echo git)
// push`) is not reached, and the handler cannot resolve it either.
//
// Dependency-light by contract: fs, git-command.js (which requires only path)
// and harness-refusal.js (which requires nothing), plus guard-rewrite.js (path
// and ../path-guard), loaded only on a pre-tool-use skip. Adding a heavier require here
// moves cost onto EVERY Bash call. The same holds for user-prompt-submit: it fires
// on every human prompt and Claude Code waits for it, so it is governed here too,
// by a raw substring test on `claude-tweaks:` with no JSON parse.
'use strict';
const fs = require('fs');
const path = require('path');
const { GUARDED_PROGRAM_WORDS, forEachShellSegment, redirectRawTargets, resolveWriteTarget } = require('./git-command');
const { REFUSAL_SIGNATURES } = require('./harness-refusal');

// Both word sets come from git-command.js, where the parsers that key on these
// words live (#3092): pre-tool-use runs every guard family, post-tool-use only the
// git family (gitTargets and teardownTargets' Bash branch). No word is typed here.
const PRE_TOOL_USE_WORDS = Object.freeze(Object.values(GUARDED_PROGRAM_WORDS).flat());
const POST_TOOL_USE_WORDS = GUARDED_PROGRAM_WORDS.git;
const WORDS_BY_EVENT = Object.freeze({
  'pre-tool-use': PRE_TOOL_USE_WORDS,
  'post-tool-use': POST_TOOL_USE_WORDS,
});

// `=` is a separator so every assignment VALUE is a piece of its own:
// substituteVars (git-command.js) can put an assigned value into the program
// position (`G=git; $G commit`), and the value is the only place the covered
// word is spelled out.
const SEPARATORS = /[\s;&|()<>`{}=]+/;

// substituteVars also rewrites a token that merely CONTAINS a reference into
// prefix + value + suffix (`G=gi; ${G}t push` is `git push`), so no single word
// or assignment value spells the program. A command with BOTH a shell assignment
// and a `$NAME`/`${NAME}` reference is exactly where that can happen, so it runs
// the full handler. A false "run" (`P=/tmp; echo $P`) costs only the module load.
const ASSIGNMENT = /(^|[\s;&|(`])[A-Za-z_][A-Za-z0-9_]*=/;
const PARAM_REFERENCE = /\$\{?[A-Za-z_]/;

// The cwd a redirect value is resolved against: a drive-named value gets that drive's root, any other '.'.
function anchorFor(raw) {
  return /^[A-Za-z]:/.test(raw) ? `${raw.slice(0, 2)}\\` : '.';
}

// #3080: bare shell redirection (`>`, `>>`, ...) has no command word for
// commandWords() to key on, so it needs its own check. It reuses the parser's
// own scan (git-command.js is already loaded) rather than a second scanner:
// redirectRawTargets finds each segment's redirect values, and resolveWriteTarget
// applies the parser's exclusions to each one. It must stay a superset of what
// fileWriteTargets can report under ANY real cwd, so it never resolves against a
// real one: the '.' cwd is a placeholder that only anchors relative targets, which this
// boolean never inspects, and the DEVNULL_LIKE/fd-dup/unresolvable exclusions
// are cwd-independent — so `2>&1` and `> /dev/null` still take the skip path.
// The one cwd-dependent rule is the win32 drive-relative one (#4281): `D:x`
// resolves against a cwd on drive D: and is unprovable against any other, so a
// value that names a drive is anchored at that drive's root instead of '.', and
// counts whenever some cwd would resolve it. `pathImpl` (default `path`) is
// injectable so a path.win32 pin runs on any host.
// It walks the same forEachShellSegment as fileWriteTargets (#3989/#4149): the
// outer text and every kept heredoc body chunk, so a `>` inside a body the parser
// drops does not send a call down the full path, while one in a kept body does.
// The glued shapes `echo foo>x` (#4015), `echo "hi">x` and `(ls)>out` (#4210) are
// reached because the handler's `quoting` object, `spanKinds` included, is forwarded
// to redirectRawTargets.
function hasFileRedirection(command, { pathImpl = path } = {}) {
  let found = false;
  forEachShellSegment(command, '.', (t, _cwd, quoting) => {
    if (!found && redirectRawTargets(t, quoting).some((raw) => resolveWriteTarget(anchorFor(raw), raw, pathImpl))) found = true;
  }, { pathImpl });
  return found;
}

function commandWords(command) {
  const words = new Set();
  for (const piece of command.split(SEPARATORS)) {
    // Quotes are dropped everywhere in the piece, not just at its ends: the
    // handler's tokenizer merges adjacent spans, so `"g"it` is the word `git`.
    const unquoted = piece.replace(/["']+/g, '').replace(/\.exe$/i, '');
    if (!unquoted) continue;
    // `\` is both a Windows path separator (`C:\Git\bin\git.exe`) and a shell
    // escape (`g\it`), so both readings are added — extra words only widen the
    // superset.
    const cut = Math.max(unquoted.lastIndexOf('/'), unquoted.lastIndexOf('\\'));
    words.add(cut >= 0 ? unquoted.slice(cut + 1) : unquoted);
    words.add(unquoted.slice(unquoted.lastIndexOf('/') + 1).replace(/\\/g, ''));
  }
  return words;
}

// Own-property lookup: `WORDS_BY_EVENT['toString']` would otherwise resolve to
// an Object.prototype member and read as a governed event.
function wordsFor(event) {
  return Object.prototype.hasOwnProperty.call(WORDS_BY_EVENT, event) ? WORDS_BY_EVENT[event] : null;
}

function shouldRunFull(event, input) {
  const covered = wordsFor(event);
  if (!covered) return true;
  if (!input || typeof input !== 'object' || input.tool_name !== 'Bash') return true;
  const typed = input.tool_input && input.tool_input.command;
  if (typeof typed !== 'string') return true;
  // #4281: bash drops a NUL from its input, and so does forEachShellSegment, so `gi<NUL>t commit`
  // is `git commit` to the parsers; the words are read the same way to stay their superset.
  const command = typed.replace(/\0/g, '');
  // #4281: bash joins a backslash-newline, and so do the parsers, so `g\`+newline+`it commit` is `git
  // commit`. The checks read the command both as typed and joined. The joined reading drops a
  // backslash-newline only where the backslash is unescaped (an odd run of them), as bash does, so
  // `a\\`+newline+`G=gi` still separates; joining one bash keeps inside single quotes only adds words.
  // An assignment and a reference may each show in only one reading, so either reading counts for
  // each. hasFileRedirection walks the parser itself, which joins them as bash does.
  const readings = command.includes('\\\n')
    ? [command, command.replace(/(\\+)\n/g, (run, slashes) => (slashes.length % 2 ? slashes.slice(0, -1) : run))]
    : [command];
  if (readings.some((c) => ASSIGNMENT.test(c)) && readings.some((c) => PARAM_REFERENCE.test(c))) return true;
  // pre-tool-use only: fileWriteTargets, the sole consumer of redirection
  // targets, never runs in post-tool-use's handler, so checking there would be
  // pure cost.
  if (event === 'pre-tool-use' && hasFileRedirection(command)) return true;
  return readings.some((c) => {
    const present = commandWords(c);
    return covered.some((word) => present.has(word));
  });
}

// #2783: post-tool-use-failure fires on EVERY failed Bash call, yet its handler
// only acts on the harness worktree-isolation refusal, whose text always carries
// one of these phrases (harness-refusal.js's REFUSAL_SIGNATURES, the tails of
// post-tool-use-failure.js's HARNESS_ISOLATION_REFUSAL_RE; #3819 added the
// worktree-gone one). Matched on the raw payload OR the parsed `error`, so a
// JSON-escaped spelling still runs.
// Unparseable input skips: the handler does nothing with it either.
function failureCarriesRefusal(raw, input) {
  const carriesSignature = (text) => REFUSAL_SIGNATURES.some((signature) => text.includes(signature));
  if (carriesSignature(raw)) return true;
  return Boolean(input && typeof input.error === 'string' && carriesSignature(input.error));
}

// Reads stdin once — the caller must hand `raw` on to the full handler, since
// stdin cannot be read a second time. Returns null (and reads nothing) for
// every event this filter does not govern. A pre-tool-use skip may also carry
// `json` (the guard normalizer's updatedInput), which bin/hooks.js prints.
// `deps.rewriteForGuard` is a test seam.
function earlyGate(event, readRaw = () => fs.readFileSync(0, 'utf8'), deps = {}) {
  const isFailure = event === 'post-tool-use-failure';
  const isPrompt = event === 'user-prompt-submit';
  if (!wordsFor(event) && !isFailure && !isPrompt) return null;
  let raw = '';
  try { raw = readRaw(); } catch { raw = ''; }
  // JSON never escapes `/` or `:`, so `claude-tweaks:` is a superset of every
  // payload user-prompt-submit.js can record; the handler makes the real call.
  // Unreadable or unparseable stdin skips: the handler would do nothing with it.
  if (isPrompt) return { raw, skip: !raw.includes('claude-tweaks:') };
  let input = null;
  try { input = JSON.parse(raw); } catch { input = null; }
  if (isFailure) {
    let carries = true;
    try { carries = failureCarriesRefusal(raw, input); } catch { carries = true; }
    return { raw, skip: !carries };
  }
  // stdin is already drained, so `raw` must survive even if the decision throws.
  let skip = false;
  try { skip = !shouldRunFull(event, input); } catch { skip = false; }
  if (!skip || event !== 'pre-tool-use') return { raw, skip };
  // #4028: a skipped Bash call still gets the guard normalizer — its shapes
  // (`node -e '…' "$A"`, `ls /a\ b`, `cd <cwd> && …`) rarely carry a covered word.
  // A throw, or a require failure, leaves the plain skip.
  let hookSpecificOutput = null;
  try {
    const guardRewrite = require('./guard-rewrite');
    hookSpecificOutput = guardRewrite.guardRewriteOutput(input, deps.rewriteForGuard || guardRewrite.rewriteForGuard);
  } catch { hookSpecificOutput = null; }
  return hookSpecificOutput ? { raw, skip, json: { hookSpecificOutput } } : { raw, skip };
}

module.exports = { PRE_TOOL_USE_WORDS, POST_TOOL_USE_WORDS, commandWords, shouldRunFull, earlyGate, hasFileRedirection };
