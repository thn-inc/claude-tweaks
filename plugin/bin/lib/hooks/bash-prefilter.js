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
// Dependency-light by contract: fs plus git-command.js (which requires only
// path). Adding a heavier require here moves cost onto EVERY Bash call.
'use strict';
const fs = require('fs');
const { WRITE_SHAPES } = require('./git-command');

// `env` is kept for parity with the retired `Bash(env -*)` predicate; every
// env-wrapped shape the handler acts on also carries a `git` or write-shape
// word, so it is redundant in practice and costs nothing as superset hygiene.
const PRE_TOOL_USE_WORDS =Object.freeze(['git', 'env', 'mkdir', ...WRITE_SHAPES]);
const POST_TOOL_USE_WORDS = Object.freeze(['git', 'env']);
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
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return true;
  if (ASSIGNMENT.test(command) && PARAM_REFERENCE.test(command)) return true;
  const present = commandWords(command);
  return covered.some((word) => present.has(word));
}

// Reads stdin once — the caller must hand `raw` on to the full handler, since
// stdin cannot be read a second time. Returns null (and reads nothing) for
// every event this filter does not govern.
function earlyGate(event, readRaw = () => fs.readFileSync(0, 'utf8')) {
  if (!wordsFor(event)) return null;
  let raw = '';
  try { raw = readRaw(); } catch { raw = ''; }
  let input = null;
  try { input = JSON.parse(raw); } catch { input = null; }
  // stdin is already drained, so `raw` must survive even if the decision throws.
  let skip = false;
  try { skip = !shouldRunFull(event, input); } catch { skip = false; }
  return { raw, skip };
}

module.exports = { PRE_TOOL_USE_WORDS, POST_TOOL_USE_WORDS, commandWords, shouldRunFull, earlyGate };
