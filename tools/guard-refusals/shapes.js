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

// Literal text inside single quotes never expands, so keyword and variable
// detectors judge the text with those spans emptied.
function stripSingle(text) {
  return text.replace(/'[^']*'/g, "''");
}

// Every quoted span collapsed to Q, for detectors that judge shell structure
// (operators, redirects, unquoted tokens) rather than argument content.
function stripQuoted(text) {
  return text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q');
}

function keyword(word) {
  const re = new RegExp(`(?<![\\w./-])${word}(?![\\w./-])`);
  return (text) => re.test(stripSingle(text));
}

const GH_JQ_PIPE = new RegExp(`${CMD}gh\\s[^\\n]*--jq[\\s=]+(?:'[^']*\\|[^']*'|"[^"]*\\|[^"]*")`);
const GH_REPO_URL = new RegExp(`${CMD}gh\\s[^\\n]*--repo[\\s=]+["']?(?:https?://)?github\\.com/`);
const GH_CHAINED_STATUS = new RegExp(`${CMD}gh\\s[^\\n]*?(?:;|&&)[^\\n]*\\$\\?`);
const QUOTED_GIT = /'[^']*(?<![\w-])git(?![\w-])[^']*'|"[^"]*(?<![\w-])git(?![\w-])[^"]*"/;
const REDIRECT_TO_VAR = new RegExp(`(?<![<>&\\d])>>?\\s*"?${VAR}`);
const GIT_COMMAND = /(?:^|[\s;&|(])git\s+[a-z]/m;
const NODE_EVAL_SCRIPT_VAR = new RegExp(`${CMD}node\\s+(?:-e|-p|--eval|--print)\\s+"[^"]*${VAR}`);
const HEREDOC = /(?<!<)<<(?!<)-?\s*['"]?[A-Za-z_]\w*/;
const STDOUT_FILE_REDIRECT = /(?<![<>&\d])>>?(?!&)\s*\S/;

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
    test: keyword('complete'),
  },
  {
    id: 'git-env-var-subst',
    row: '`CT_HOOKS_GIT_TIMEOUT_MS=60000 echo $(echo hi)`',
    test: (t) => t.split(/\r?\n/).some((l) => /(?:^|[\s;&|(])[A-Za-z_]*GIT\w*=/.test(l) && l.includes('$(')),
  },
  {
    id: 'github-url-with-var',
    row: '`echo "https://github.com/o/r/pull/1" --run "$RUN_DIR"`',
    test: (t) => /github\.com/.test(t) && new RegExp(VAR).test(stripSingle(t)),
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
