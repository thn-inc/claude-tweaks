// tests/skill-prose-plugin-root-invocations.test.js — pins #1170: skill prose must never
// invoke a plugin bin via a repo-relative `node plugin/bin/…` path. In any consumer project
// running the installed plugin there is no plugin/ subtree, so the invocation dies with
// MODULE_NOT_FOUND — and degrade clauses ("log a warning and continue") swallow it, so the
// step silently never runs anywhere but this repo itself. The `"${CLAUDE_PLUGIN_ROOT}/bin/…"`
// form is the only install-safe invocation.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');

// Documented exemptions — file (relative to plugin/skills/) -> why repo-relative is correct there.
// release.js is a maintainer command run from a clean main checkout of the claude-tweaks repo
// itself (CLAUDE.md `## Releasing`, docs/releasing.md use the identical form), never from an
// installed consumer plugin.
const EXEMPT = new Map([
  ['flow/summary-template.md', /node plugin\/bin\/release\.js/],
]);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.md')) yield p;
  }
}

// A `compose-context.js` invocation whose source argument is a repo-relative `plugin/skills/…`
// path is install-dead the same way a repo-relative `node plugin/bin/…` invocation is (#1170):
// it resolves only inside a claude-tweaks checkout, so the call fails (and the fallback fires)
// in every installed consumer. The install-safe form is
// `"${CLAUDE_PLUGIN_ROOT}/skills/_shared/{file}.md"` (docs/skill-authoring.md's Call-site form).
function isComposeContextSourceRepoRelative(line) {
  return line.includes('compose-context.js') && line.includes(' plugin/skills/');
}

// The predicate above is per-line, so normalize the two wrap shapes that would put a
// compose-context invocation's source arg on a later line than `compose-context.js` and hide
// a repo-relative offender (the same blind spot the `node\nplugin/bin/` normalization below
// closes for #1170): a backticked invocation wrapped mid-span (a code span may span lines),
// and a fenced-block invocation continued with a trailing backslash. The span match must stay
// anchored on the backtick-then-`node ` opener — a ``` fence opener is never followed by `node `,
// so it can't act as the span delimiter and collapse a whole fenced block onto one line.
function joinComposeContextInvocations(text) {
  return text
    .replace(/`node [^`]*compose-context\.js[^`]*`/g, (span) => span.replace(/\s*\n\s*/g, ' '))
    .replace(/compose-context\.js(?:[^\n]*\\\n)+[^\n]*/g, (block) => block.replace(/\\\n\s*/g, ' '));
}

test('no skill prose invokes a bin via a repo-relative `node plugin/bin/` path (install-dead — #1170)', () => {
  const offenders = [];
  for (const file of walk(SKILLS)) {
    const rel = path.relative(SKILLS, file);
    // Normalize the one wrap shape that hid the original bug: `node` at end-of-line,
    // `plugin/bin/…` starting the next line (pr-early-run-lifecycle.md's own line wrap).
    const text = joinComposeContextInvocations(
      fs.readFileSync(file, 'utf8').replace(/node\s*\n\s*plugin\/bin\//g, 'node plugin/bin/'),
    );
    const exemptRe = EXEMPT.get(rel);
    for (const line of text.split('\n')) {
      const isInvokedRepoRelative = line.includes('node plugin/bin/');
      const isExempted = exemptRe && exemptRe.test(line);
      if (isInvokedRepoRelative && !isExempted) {
        offenders.push(`${rel}: ${line.trim().slice(0, 120)}`);
      }
      if (isComposeContextSourceRepoRelative(line) && !isExempted) {
        offenders.push(`compose-context source arg is repo-relative: ${rel}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `repo-relative plugin/bin invocations in skill prose:\n${offenders.join('\n')}`);
});

test('the exemption list only exempts lines that still exist (no stale exemptions)', () => {
  for (const [rel, re] of EXEMPT) {
    const text = fs.readFileSync(path.join(SKILLS, rel), 'utf8');
    assert.ok(re.test(text), `stale exemption: ${rel} no longer contains ${re}`);
  }
});

test('the compose-context source-arg check can actually go red (predicate proof)', () => {
  const repoRelative = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run x --step y plugin/skills/_shared/a.md';
  const installSafe = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run x --step y "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md"';
  const offendersRepoRelative = [repoRelative].filter(isComposeContextSourceRepoRelative);
  const offendersInstallSafe = [installSafe].filter(isComposeContextSourceRepoRelative);
  assert.equal(offendersRepoRelative.length, 1);
  assert.equal(offendersInstallSafe.length, 0);
});

test('a compose-context invocation wrapped across lines is still caught when its source arg is repo-relative (wrap-shape proof)', () => {
  const wrappedSpan = 'Read it as one bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR"\n  --step merge plugin/skills/_shared/a.md`, then read the bundle.';
  const wrappedFence = '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge \\\n  "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md" \\\n  plugin/skills/_shared/b.md\n```';
  const wrappedInstallSafe = 'Read it as one bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR"\n  --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md"`, then read the bundle.';
  const offendersIn = (text) => joinComposeContextInvocations(text).split('\n').filter(isComposeContextSourceRepoRelative);
  // Unnormalized, the per-line predicate misses both wrapped offenders — the blind spot the join closes.
  assert.equal(wrappedSpan.split('\n').filter(isComposeContextSourceRepoRelative).length, 0);
  assert.equal(wrappedFence.split('\n').filter(isComposeContextSourceRepoRelative).length, 0);
  assert.equal(offendersIn(wrappedSpan).length, 1);
  assert.equal(offendersIn(wrappedFence).length, 1);
  assert.equal(offendersIn(wrappedInstallSafe).length, 0);
  // Negative control for the span anchor: a fence that names compose-context.js on one line and an
  // unrelated plugin/skills/ path on another, with no continuation, must stay two lines — a span
  // regex not anchored on `node ` would take the ``` opener as its delimiter, collapse the block,
  // and report a false offender.
  const fenceNoContinuation = '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md"\nls plugin/skills/_shared/\n```';
  assert.equal(offendersIn(fenceNoContinuation).length, 0);
});
