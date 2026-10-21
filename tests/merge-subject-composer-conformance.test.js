// tests/merge-subject-composer-conformance.test.js — pins #2251's merge-site contract:
// every merge site sources its subject/body from bin/compose-subject.js (AC 5), the two
// pr-first sites squash (AC 1), and pr-first-merge.md stays net-small (AC 6). Frozen
// pre-change excerpts prove each pattern can go red (skill-prose-conformance-tests, IL-105).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('node:fs');
const os = require('node:os');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const PR_FIRST = 'plugin/skills/_shared/pr-first-merge.md';
const LOCAL_SITES = [
  'plugin/skills/_shared/local-merge-auto-finish.md',
  'plugin/skills/wrap-up/auto-merge-short-circuit.md',
  'plugin/skills/dispatch/settle-and-merge.md',
  'plugin/skills/flow/worktree-merge.md',
];

// Frozen pre-change excerpts (byte-for-byte from the pre-#2251 files).
const PRE_PR_FIRST_SITE = `gh pr merge {pr-number} --repo {owner}/{repo} --auto --merge \\
  -t "[{tag}] {one-line summary}" \\
  -b "$(printf 'Fixes #%s\\n' {issue-list})"`;
const PRE_LOCAL_SITE = `git merge --no-ff {branch} -m "[auto-merge] {one-line summary}

Fixes #{issue}
Fixes #{second-issue}"`;
const PRE_WORKTREE_MERGE_SITE = `   git merge --no-ff {branch} -m "Merge {branch} — specs {list}

   Fixes #{issue}
   Fixes #{second-issue}"`;
// The pre-#3298 composer call — no changed-paths source (neither --range nor --pr).
const PRE_RANGELESS_CALL = `SUBJECT_EXPORTS=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag auto-finish --shell) || exit 1
   eval "$SUBJECT_EXPORTS"`;
// The pre-#3298 worktree-merge.md call (two-issue form, no changed-paths source).
const PRE_WORKTREE_RANGELESS_CALL = `   SUBJECT_EXPORTS=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} {second-issue} --shell) || exit 1
   eval "$SUBJECT_EXPORTS"`;

// local-merge fences read the changed paths from a local `--range {base}...{head}` diff;
// pr-first fences read them from the PR itself via `--pr {pr-number}` (#3298 final review).
const LOCAL_COMPOSER_CALL = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--range \{[a-z-]+\}\.\.\.\{[a-z-]+\} --out-dir "\{subject-dir\}" \|\| exit 1\n/;
// The pre-#3522 local-merge fence (local-merge-auto-finish.md, byte-for-byte): composer under
// `$(…) || exit 1`, then `eval`, then `-m "$SUBJECT_TITLE⏎⏎$SUBJECT_BODY"`.
const PRE_EVAL_LOCAL_SITE = `   SUBJECT_EXPORTS=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag auto-finish --range {base-branch}...{feature-branch} --shell) || exit 1
   eval "$SUBJECT_EXPORTS"
   git merge --no-ff {feature-branch} -m "$SUBJECT_TITLE

$SUBJECT_BODY"`;
// The pre-#3522 pr-first fence (byte-for-byte): composer under `$(…) || exit 1`, then `eval`.
const PRE_EVAL_PR_FIRST_SITE = `SUBJECT_EXPORTS=$(node "\${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --pr {pr-number} --shell) || exit 1
eval "$SUBJECT_EXPORTS"
gh pr merge {pr-number} --repo {owner}/{repo} --auto --squash \\
  -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"`;
// pr-first fences compose to files (#3522): the composer line is a plain command, no eval, no `$(…)`.
const PR_FIRST_COMPOSER_CALL = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--pr \{pr-number\} --out-dir "\{subject-dir\}"\n/;
const LOCAL_MERGE_FORM = /git merge --no-ff \{[a-z-]+\} -F "\{subject-dir\}\/message\.txt"/;
const STALE_LOCAL_FORM = /git merge --no-ff \{[a-z-]+\} -m "(\[|Merge \{branch\})/;
const STALE_PR_FIRST_FORM = /gh pr merge \{pr-number\}[^\n]*--merge \\/;

test('pr-first-merge.md: both gh pr merge sites squash and take the composer output', () => {
  const text = read(PR_FIRST);
  const squashSites = text.match(/gh pr merge \{pr-number\} --repo \{owner\}\/\{repo\} (--auto )?--squash -t \{title-arg\} --body-file "\{subject-dir\}\/body\.md"/g) || [];
  assert.equal(squashSites.length, 2, 'expected exactly two squash merge sites');
  assert.match(text, PR_FIRST_COMPOSER_CALL);
  assert.doesNotMatch(text, /--range \{/, 'pr-first fences carry no --range');
  // F1: the degrade fence (the `--squash` site under `merge-verification: off`) no longer relies
  // on the first fence's shell state surviving into its own, separate Bash call — it runs its
  // own composer call, same as the first fence.
  const composerCalls = text.match(new RegExp(PR_FIRST_COMPOSER_CALL.source, 'g')) || [];
  assert.equal(composerCalls.length, 2, 'expected both squash sites to run their own composer call');
  assert.doesNotMatch(text, STALE_PR_FIRST_FORM);
  assert.doesNotMatch(text, /-t "\[\{tag\}\] \{one-line summary\}"/);
  // go-red proof
  assert.match(PRE_PR_FIRST_SITE, STALE_PR_FIRST_FORM);
  assert.doesNotMatch(PRE_PR_FIRST_SITE, PR_FIRST_COMPOSER_CALL);
  assert.doesNotMatch(PRE_EVAL_PR_FIRST_SITE, PR_FIRST_COMPOSER_CALL);
  // negative control: the unquoted form must not match — the quote around {subject-dir} is pinned
  // (the path comes from os.tmpdir() and can contain a space).
  const unquoted = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --pr {pr-number} --out-dir {subject-dir}\n';
  assert.doesNotMatch(unquoted, PR_FIRST_COMPOSER_CALL);
  // the {subject-dir} definition (paste target of every fence) is pinned where the pointers land.
  assert.ok(text.includes('session-tmp-resolve.js" SUBJECT_DIR=merge-subject-{key}'), '{subject-dir} definition present');
});

test('AC1.1: pr-first-merge.md carries no eval "$SUBJECT_EXPORTS"', () => {
  const text = read(PR_FIRST);
  // Fixed-string counts: BSD grep reads a mid-pattern `$` as an anchor.
  assert.equal(text.split('eval "$SUBJECT_EXPORTS"').length - 1, 0);
  assert.equal(text.split('SUBJECT_EXPORTS=').length - 1, 0);
  assert.equal(text.split('--shell').length - 1, 0);
  assert.doesNotMatch(text, /^\s*gh [^\n]*\$\(/m, 'no gh line wraps a command substitution');
  // go-red proof
  assert.equal(PRE_EVAL_PR_FIRST_SITE.split('eval "$SUBJECT_EXPORTS"').length - 1, 1);
  assert.ok(PRE_EVAL_PR_FIRST_SITE.includes('SUBJECT_EXPORTS=') && PRE_EVAL_PR_FIRST_SITE.includes('--shell'));
  assert.match('gh pr merge 1 -b "$(printf x)"', /^\s*gh [^\n]*\$\(/m);
});

test('AC3.1: each pr-first fence is one plain command', () => {
  const text = read(PR_FIRST);
  const start = text.indexOf('## Step 3:');
  assert.notEqual(start, -1, 'Step 3 heading present');
  const end = text.indexOf('\n## ', start + 1);
  const step3 = text.slice(start, end === -1 ? undefined : end);
  const fences = [];
  let cur = null;
  for (const line of step3.split('\n')) {
    if (cur === null && /^\s*```bash\s*$/.test(line)) cur = [];
    else if (cur !== null && /^\s*```\s*$/.test(line)) { fences.push(cur); cur = null; }
    else if (cur !== null) cur.push(line);
  }
  const merging = fences.filter((f) => /compose-subject\.js|gh pr merge/.test(f.join('\n')));
  assert.equal(merging.length, 4, 'two composer fences + two gh pr merge fences');
  for (const f of merging) {
    assert.equal(f.length, 1, `fence is a single line: ${f.join(' / ')}`);
    assert.doesNotMatch(f[0], /\beval\b|\$\(|&&|\|\||;|\\$/, `fence is a plain command: ${f[0]}`);
  }
  // go-red proof: the pre-change fence is multi-line, evals, and wraps `$(…)`.
  assert.ok(PRE_EVAL_PR_FIRST_SITE.split('\n').length > 1);
  assert.match(PRE_EVAL_PR_FIRST_SITE, /\beval\b|\$\(|\|\|/);
});

for (const rel of LOCAL_SITES) {
  test(`${path.basename(rel)}: the --no-ff merge sources -m from the composer`, () => {
    const text = read(rel);
    assert.match(text, LOCAL_COMPOSER_CALL, 'composer line composes to {subject-dir}');
    assert.match(text, LOCAL_MERGE_FORM, 'merge takes -F {subject-dir}/message.txt');
    assert.doesNotMatch(text, STALE_LOCAL_FORM, 'no free-form -m subject remains');
    // Fixed-string counts: BSD grep reads a mid-pattern `$` as an anchor.
    assert.equal(text.split('eval "$SUBJECT_EXPORTS"').length - 1, 0, 'no eval of the composer output');
    assert.equal(text.split('SUBJECT_EXPORTS=').length - 1, 0);
    assert.equal(text.split('--shell').length - 1, 0);
    assert.equal(text.split('$SUBJECT_TITLE').length - 1, 0);
    assert.ok(text.includes('`{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3'), 'pointer to the {subject-dir} definition');
  });
}

test('go-red proof: the frozen pre-change local-merge forms match the stale pattern and not the new one', () => {
  for (const pre of [PRE_LOCAL_SITE, PRE_WORKTREE_MERGE_SITE]) {
    assert.match(pre, STALE_LOCAL_FORM);
    assert.doesNotMatch(pre, LOCAL_MERGE_FORM);
    assert.doesNotMatch(pre, LOCAL_COMPOSER_CALL);
  }
  assert.doesNotMatch(PRE_EVAL_LOCAL_SITE, LOCAL_COMPOSER_CALL);
  assert.doesNotMatch(PRE_EVAL_LOCAL_SITE, LOCAL_MERGE_FORM);
  assert.doesNotMatch(PRE_RANGELESS_CALL, LOCAL_COMPOSER_CALL);
  assert.doesNotMatch(PRE_RANGELESS_CALL, PR_FIRST_COMPOSER_CALL);
  assert.doesNotMatch(PRE_WORKTREE_RANGELESS_CALL, LOCAL_COMPOSER_CALL);
  assert.doesNotMatch(PRE_WORKTREE_RANGELESS_CALL, PR_FIRST_COMPOSER_CALL);
});

// AC1 (#3537): a whole-tree sweep, not the five named files above. Walks `root` for *.md
// (skipping node_modules) and flags every fenced block that runs compose-subject.js and evals
// its output — `--shell`, `SUBJECT_EXPORTS`, or a bare `eval`. Fences are read line by line so an
// indented or list-nested fence opens and closes the same way a top-level one does.
function sweepShellEvalFences(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) files.push(abs);
    }
  };
  walk(root);
  const hits = [];
  for (const abs of files) {
    let fence = null;
    for (const line of readText(abs).split('\n')) {
      if (fence === null) {
        if (/^\s*```/.test(line)) fence = [line];
        continue;
      }
      fence.push(line);
      if (!/^\s*```\s*$/.test(line)) continue;
      const body = fence.join('\n');
      fence = null;
      if (body.includes('compose-subject.js') && (body.includes('--shell') || body.includes('SUBJECT_EXPORTS') || /\beval\b/.test(body))) {
        hits.push({ file: path.relative(root, abs), fence: body });
      }
    }
  }
  return { files: files.map((abs) => path.relative(root, abs)), hits };
}

test('AC1.1: no fenced block anywhere in plugin/skills/** evals compose-subject.js --shell output', () => {
  const skillsRoot = path.join(ROOT, 'plugin/skills');
  const { files, hits } = sweepShellEvalFences(skillsRoot);
  for (const rel of [PR_FIRST, ...LOCAL_SITES]) {
    assert.ok(files.includes(path.relative(skillsRoot, path.join(ROOT, rel))), `sweep reached ${rel}`);
  }
  assert.deepEqual(hits, []);
});

test('AC1.1 go-red: the same sweep flags a frozen pre-#3522 eval fence, indented and nested', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-eval-sweep-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'nested', 'dir'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'nested', 'dir', 'a.md'), `1. Merge:\n\n   \`\`\`bash\n${PRE_EVAL_LOCAL_SITE}\n   \`\`\`\n`);
    fs.writeFileSync(path.join(tmpRoot, 'b.md'), `\`\`\`bash\n${PRE_EVAL_PR_FIRST_SITE}\n\`\`\`\n`);
    fs.writeFileSync(path.join(tmpRoot, 'c.md'), '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --out-dir "{subject-dir}" || exit 1\n```\n');
    const { hits } = sweepShellEvalFences(tmpRoot);
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((h) => h.file).sort(), ['b.md', path.join('nested', 'dir', 'a.md')]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
