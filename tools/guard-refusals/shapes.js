'use strict';
// tools/guard-refusals/shapes.js — #4028: static detectors for the Bash shapes
// Claude Code's worktree isolation guard refuses, one per refused row of
// plugin/skills/_shared/scratch-worktree.md section 7. Each detector names the
// row it covers by that row's exact Example cell (`row`), and
// tests/guard-refusals/shapes.test.js holds the two in lockstep: every refused
// row is flagged by its bound detector (or excused in UNDETECTED_ROWS), and no
// detector fires on a passes-row example.
//
// The detectors read command text, not a parse: they are regex/token
// predicates over one Bash call's text (a fence body, or a transcript command).

// A runtime variable reference: $NAME or ${NAME (not $?, $1, $$).
const VAR = String.raw`\$\{?[A-Za-z_]`;
// A command word boundary: the word is not part of a path, flag or longer name.
const CMD = String.raw`(?<![\w./-])`;

// One left-to-right shell-lexing pass: the state of each char of `text`, one of
// 'plain', 'delim' (a quote char that opens or closes a span), 'single',
// 'double' or 'comment'. Pairing quotes with a regex instead lets an apostrophe
// in a `#` comment or inside "…" pair with a later quote and hide the commands
// between them. Outside quotes a backslash escapes the next char; inside "…" a
// backslash escape does not close the quote; inside '…' nothing escapes. `#`
// at word start, outside quotes, opens a comment that runs to end of line. A
// quote left open at end of line stays open across the newline, as in shell.
// A heredoc operator (`<<WORD`, `<<'WORD'`, `<<"WORD"`, `<<-WORD`) outside
// quotes and comments makes the lines after its own line, up to and including
// the delimiter line, 'heredoc' data: an apostrophe there is not a quote, and a
// banned word there is not a command. `<<-` allows leading tabs on the
// delimiter line; an unterminated body runs to end of text, as in shell.
const HEREDOC_OP = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([A-Za-z_]\w*))/;

function lexShell(text) {
  const kinds = new Array(text.length);
  let state = 'plain';
  let pending = []; // heredocs opened on the current line: { delim, tabs }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' && pending.length && (state === 'plain' || state === 'comment')) {
      kinds[i] = 'plain';
      state = 'plain';
      i = markHeredocBodies(text, i + 1, pending, kinds) - 1;
      pending = [];
      continue;
    }
    if (state === 'single') {
      if (c === "'") { kinds[i] = 'delim'; state = 'plain'; } else kinds[i] = 'single';
    } else if (state === 'double') {
      if (c === '\\' && i + 1 < text.length) { kinds[i] = 'double'; kinds[++i] = 'double'; } else if (c === '"') { kinds[i] = 'delim'; state = 'plain'; } else kinds[i] = 'double';
    } else if (state === 'comment') {
      if (c === '\n') { kinds[i] = 'plain'; state = 'plain'; } else kinds[i] = 'comment';
    } else if (c === '\\' && i + 1 < text.length) {
      kinds[i] = 'plain'; kinds[++i] = 'plain';
    } else if (c === '<' && text[i - 1] !== '<' && text[i + 2] !== '<' && HEREDOC_OP.test(text.slice(i, i + 256))) {
      const m = HEREDOC_OP.exec(text.slice(i, i + 256));
      pending.push({ delim: m[2] || m[3] || m[4], tabs: m[1] === '-' });
      // Only the `<<-` operator is consumed here; a quoted delimiter is lexed
      // as an ordinary quote span on the operator line.
      kinds[i] = 'plain'; kinds[++i] = 'plain';
      if (m[1] === '-') kinds[++i] = 'plain';
    } else if (c === "'" || c === '"') {
      kinds[i] = 'delim'; state = c === "'" ? 'single' : 'double';
    } else if (c === '#' && (i === 0 || /[\s;&|()<>]/.test(text[i - 1]))) {
      kinds[i] = 'comment'; state = 'comment';
    } else kinds[i] = 'plain';
  }
  return kinds;
}

// Mark each pending heredoc's body lines, from `start`, as 'heredoc' through
// its delimiter line; returns the index where shell text resumes.
function markHeredocBodies(text, start, pending, kinds) {
  let i = start;
  for (const { delim, tabs } of pending) {
    while (i < text.length) {
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      const line = text.slice(i, end).replace(/\r$/, '');
      for (let j = i; j < end; j++) kinds[j] = 'heredoc';
      if (end < text.length) kinds[end] = 'plain';
      i = end + 1;
      if ((tabs ? line.replace(/^\t+/, '') : line) === delim) break;
    }
  }
  return Math.min(i, text.length);
}

// `text` with every char whose lexed state is in `states` blanked to a space,
// line breaks kept, so length and line structure survive.
function blankStates(text, states) {
  const kinds = lexShell(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += states.has(kinds[i]) && c !== '\n' && c !== '\r' ? ' ' : c;
  }
  return out;
}

// Literal text inside single quotes never expands, comment text never runs and
// a heredoc body is data, so keyword and variable detectors judge the text with
// those emptied. Double-quoted content stays: a "$VAR" operand is what several
// detectors key on.
const SINGLE_AND_COMMENT = new Set(['single', 'comment', 'heredoc']);
function stripSingle(text) {
  return blankStates(text, SINGLE_AND_COMMENT);
}

// Every quoted span's content (and comment and heredoc text) emptied, for
// detectors that judge shell structure (operators, redirects, unquoted tokens)
// rather than argument content.
const QUOTED_AND_COMMENT = new Set(['single', 'double', 'comment', 'heredoc']);
function stripQuoted(text) {
  return blankStates(text, QUOTED_AND_COMMENT);
}

function keyword(word) {
  const re = new RegExp(`(?<![\\w./-])${word}(?![\\w./-])`);
  return (text) => re.test(stripSingle(text));
}

// The value of every shell word of `text` after quote removal. Words split on
// unquoted whitespace and on the operator chars ;&|()<>; comment and heredoc
// text belongs to no word. An outside-quotes backslash escape keeps the
// escaped char only.
function shellWords(text) {
  const kinds = lexShell(text);
  const words = [];
  let cur = null;
  const flush = () => { if (cur !== null) words.push(cur); cur = null; };
  for (let i = 0; i < text.length; i++) {
    const k = kinds[i];
    const c = text[i];
    if (k === 'comment' || k === 'heredoc') { flush(); continue; }
    if (k === 'delim') { cur = cur ?? ''; continue; }
    if (k === 'plain') {
      if (/[\s;&|()<>]/.test(c)) { flush(); continue; }
      if (c === '\\' && kinds[i + 1] === 'plain' && i + 1 < text.length) { cur = (cur ?? '') + text[++i]; continue; }
    }
    cur = (cur ?? '') + c;
  }
  flush();
  return words;
}

// The guard refuses a shell word whose whole value, quoted or bare, is `word`;
// a word that merely contains it (`"task complete"`, a `node -e` script) passes.
function wholeWord(word) {
  return (text) => shellWords(text).includes(word);
}

const GH_JQ_PIPE = new RegExp(`${CMD}gh\\s[^\\n]*--jq[\\s=]+(?:'[^']*\\|[^']*'|"[^"]*\\|[^"]*")`);
const GH_REPO_URL = new RegExp(`${CMD}gh\\s[^\\n]*--repo[\\s=]+["']?(?:https?://)?github\\.com/`);
const GH_CHAINED_STATUS = new RegExp(`${CMD}gh\\s[^\\n]*?(?:;|&&)[^\\n]*\\$\\?`);
const QUOTED_GIT = /'[^']*(?<![\w-])git(?![\w-])[^']*'|"[^"]*(?<![\w-])git(?![\w-])[^"]*"/;
const REDIRECT_TO_VAR = new RegExp(`(?<![<>&\\d])>>?\\s*"?${VAR}`);
const GIT_COMMAND = /(?:^|[\s;&|(])git\s+[a-z]/m;
const NODE_EVAL_SCRIPT_VAR = new RegExp(`${CMD}node\\s+(?:-e|-p|--eval|--print)\\s+"[^"]*${VAR}`);
const HEREDOC = /(?<!<)<<(?!<)-?\s*['"]?[A-Za-z_]\w*/;
// `>file`, `>>file`, and bash's `&>file` / `&>>file` (stdout and stderr).
const STDOUT_FILE_REDIRECT = /(?:&|(?<![<>&\d]))>>?(?!&)\s*\S/;

function chainedHeredocWrite(text) {
  return stripQuoted(text).split(/\r?\n/).some((line) => {
    const segments = line.split(/&&|;/);
    return segments.length > 1
      && segments.slice(1).some((s) => /(?<!<)<<(?!<)/.test(s) && STDOUT_FILE_REDIRECT.test(s.replace(/<<-?\s*\S+/, '')));
  });
}

function graphqlMultivarMutation(text) {
  if (!new RegExp(`${CMD}gh\\s+api\\s+graphql\\b`).test(text)) return false;
  const m = /mutation\s*\(([^)]*)\)/.exec(text);
  if (!m) return false;
  if ((m[1].match(/\$\w+\s*:/g) || []).length < 2) return false;
  return /\(\s*\w+\s*:\s*\{/.test(text.slice(m.index + m[0].length));
}

const DETECTORS = [
  {
    id: 'complete-token',
    row: '`echo complete`',
    test: wholeWord('complete'),
  },
  {
    id: 'git-env-var-subst',
    row: '`CT_HOOKS_GIT_TIMEOUT_MS=60000 echo $(echo hi)`',
    test: (t) => t.split(/\r?\n/).some((l) => /(?:^|[\s;&|(])[A-Za-z_]*GIT\w*=/.test(l) && l.includes('$(')),
  },
  {
    id: 'github-url-with-var',
    row: '`echo "https://github.com/o/r/pull/1" --run "$RUN_DIR"`',
    // A github.com inside a comment, a single-quoted span or a heredoc body,
    // beside a runtime variable, ran in a live probe (2026-10-24, #4028).
    test: (t) => { const s = stripSingle(t); return /github\.com/.test(s) && new RegExp(VAR).test(s); },
  },
  {
    id: 'gh-jq-pipe-chained',
    row: "`gh pr view 1 --repo o/r --json comments --jq '.comments[] \\| .id'; echo exit=$?`; `gh pr view 1 --repo github.com/o/r --json comments && echo exit=$?`",
    test: (t) => (GH_JQ_PIPE.test(t) || GH_REPO_URL.test(t)) && GH_CHAINED_STATUS.test(stripQuoted(t)),
  },
  {
    id: 'json-git-redirect-var',
    row: "`printf '%s' '[{\"finding\":\"the git index\"}]' > \"$CTX/f.json\"`",
    test: (t) => QUOTED_GIT.test(t) && REDIRECT_TO_VAR.test(stripSingle(t)),
  },
  {
    id: 'git-in-substitution',
    row: '`echo "$(git rev-parse --short HEAD)"`',
    test: (t) => /\$\(\s*git\s/.test(t),
  },
  {
    id: 'node-eval-script-var-with-git',
    row: "`git diff --numstat -z {sha} \\| node -e \"require('${CLAUDE_PLUGIN_ROOT}/bin/lib/git-z.js')\"`",
    test: (t) => GIT_COMMAND.test(t) && NODE_EVAL_SCRIPT_VAR.test(t),
  },
  {
    id: 'sed-var-path',
    row: "`sed -i '' 's/a/b/' \"$B\"`; `sed -n '1,2p' \"$P/README.md\"`",
    test: (t) => new RegExp(`${CMD}sed\\s[^;&|\\n]*\\s"?${VAR}`).test(stripSingle(t)),
  },
  {
    id: 'node-var-script',
    row: '`node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`; `node "$HOME/x.js"`',
    test: (t) => new RegExp(`${CMD}node\\s+"?\\$[{(A-Za-z_]`).test(t),
  },
  {
    id: 'node-eval-computed-arg',
    row: "`node -e '<s>' \"$HOME\"`; `A=\"$(node /lit/x.js …)\"` then `node -e '<s>' \"$A\"`",
    test: (t) => new RegExp(`${CMD}node\\s+(?:-e|-p|--eval|--print)\\s+(?:'[^']*'|"(?:[^"\\\\]|\\\\.)*")\\s+"?\\$`).test(t),
  },
  {
    id: 'graphql-multivar-mutation',
    row: "`gh api graphql -f query='mutation($a:ID!,$b:ID!){ doThing(input:{a:$a,b:$b}){ clientMutationId } }' -f a=1 -f b=2`",
    test: graphqlMultivarMutation,
  },
  {
    id: 'eval-token',
    row: '`echo eval`',
    test: keyword('eval'),
  },
  {
    id: 'heredoc-gh-body-file-var',
    row: "`cat > \"$TMPDIR/x.md\" <<'EOF' … EOF` then `gh pr comment N --body-file \"$TMPDIR/x.md\"`",
    test: (t) => HEREDOC.test(t) && new RegExp(`${CMD}gh\\s[^\\n]*--body-file[\\s=]+"?${VAR}`).test(t),
  },
  // The general chained-heredoc row and the older mkdir -p row it generalizes
  // share one detector.
  {
    id: 'chained-heredoc-write',
    row: "`mkdir -p /abs/dir && cat > /abs/dir/p.js <<'EOF'`",
    test: chainedHeredocWrite,
  },
  {
    id: 'chained-heredoc-write',
    row: "`cd \"<wt>\" && cat > f <<'EOF'`; `echo start && cat > f <<'EOF'`",
    test: chainedHeredocWrite,
  },
  {
    id: 'test-string-compare',
    row: '`test a = b`',
    test: (t) => /(?:^|[\s;&|(])test\s+[^\s"'$-]\S*\s+!?==?\s/m.test(t),
  },
  {
    id: 'backslash-space',
    row: '`ls /Users/me/Code\\ Workspaces/repo/README.md`',
    test: (t) => /[^\s\\]\\ (?=\S)/.test(stripQuoted(t)),
  },
];

// Refused-row Example cell -> why no static detector can decide it. Empty: every
// refused row today has a detector.
const UNDETECTED_ROWS = {};

// The agent substitutes a literal plugin root for these placeholders before it
// runs a command (_shared/worktree-setup.md, "Resolve plugin-supplied values to
// literals once"), so a skill fence that spells the placeholder is not the
// runtime-variable shape the guard sees.
function normalizePlaceholders(text) {
  return text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT(?!\w)/g, '/plugin-root');
}

function detectShapes(text, { placeholders = true } = {}) {
  const subject = placeholders ? normalizePlaceholders(text) : text;
  const ids = [];
  for (const d of DETECTORS) {
    if (!ids.includes(d.id) && d.test(subject)) ids.push(d.id);
  }
  return ids;
}

module.exports = { DETECTORS, UNDETECTED_ROWS, normalizePlaceholders, detectShapes };
