'use strict';
// #2932: /capture's `work-types: native` branch must stay runnable inside a
// worktree-isolated session. `_shared/scratch-worktree.md` documents two shapes
// the guard refuses that #2725's rewrite introduced — an `if VAR=$(gh …)`
// wrapper, and an inline GraphQL mutation declaring two `$var`s inside a nested
// `input:{…}` literal (its documented workaround: pass the query by file) — and
// the branch must state an outcome for each failure instead of passing silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', 'plugin', 'skills', 'capture', 'SKILL.md');

function typeBranch(text) {
  const start = text.indexOf('**Type expression branch.**');
  const end = text.indexOf('--label "type:$TYPE"', start);
  assert.ok(start >= 0 && end > start, 'capture/SKILL.md must keep its Type expression branch and the labels create');
  return text.slice(start, end);
}

// Only the commands the agent runs — the prose around them legitimately names
// the refused shapes it is steering away from.
function bashFences(section) {
  return [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
}

const branch = typeBranch(fs.readFileSync(SKILL, 'utf8'));
const commands = bashFences(branch);

test('the native branch never wraps a gh call in `if VAR=$(gh …)` — a shape the worktree guard refuses', () => {
  assert.ok(commands.includes('gh issue create'), 'expected the branch to carry its gh commands in bash fences');
  assert.doesNotMatch(commands, /\bif\s+!?\s*[A-Za-z_]\w*=\$\(\s*gh\b/);
});

test('the native branch passes its updateIssue mutation by file, never as an inline -f query literal', () => {
  assert.doesNotMatch(commands, /-f\s+query='mutation/);
  assert.match(branch, /gh api graphql -F query=@"\/tmp\/capture-\$\{CLAUDE_CODE_SESSION_ID\}-type-mutation\.graphql"/);
});

test('the native branch still detects the unknown --type rejection and falls back only on it', () => {
  assert.match(branch, /--type "\$TYPE"/);
  assert.match(branch, /unknown flag: --type/);
  assert.match(branch, /Any other failure[^.]*→ \*\*stop\*\*/);
});

test('every native-branch failure has a stated outcome — a failed fallback stops, an untyped record is reported as untyped', () => {
  assert.match(branch, /Non-zero → \*\*stop\*\* and surface gh's stderr; nothing was filed/);
  assert.match(branch, /filed but untyped: no native issue type/);
  assert.match(branch, /filed but untyped: \{gh's stderr\}/);
});
