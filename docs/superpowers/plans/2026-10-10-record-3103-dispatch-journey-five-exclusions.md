# Name All Five Removing Exclusions in the #3084 Dispatch Journey (#3103) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The #3084 dispatch journey names every reason the queue pull removes a candidate, `blocked` included, and a test keeps it in sync with `queue-pull-script.md`.

**Architecture:** Two edits to `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md`: Step 1's count and list, and the Success state's reason list. One test is appended to `tests/dispatch-named-form-exclusion-reasons.test.js`, reusing its `REMOVING_REASONS` (derived from `queue-pull-script.md`'s own bullets) so the journey can never lag a newly added reason.

**Tech Stack:** Markdown journey, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T190327-spec-3101-3102-3103-3104/spec-3103/work/3103-spec.md`

## Global Constraints

- The five removing reasons are exactly `queue-pull-script.md`'s: `blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`. `oversized` stays in `dispatch-groups.json` and is not one of them.
- A `blocked` record's report line comes from `plugin/skills/dispatch/blocked-exclusion-report.md`. Add that path to the journey's `files:` frontmatter, since the journey now names its outcome.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- The count word must match the list length ("five"), and must not stay "four" beside a five-item list. Pinned by the test.
- The Success state must name `blocked` too, or a journey-driven QA pass reading the success state still treats a blocked report as unexpected. Pinned by the test.
- The test must derive the reason set, not hard-code it, so a sixth reason added to the queue pull fails the journey check rather than passing silently. Pinned by reusing `REMOVING_REASONS`.

---

### Task 1: Name `blocked` in the journey and pin the journey to the derived reason set

**Files:**
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md:2-6` (`files:` frontmatter), `:14` (Success state), `:22` (Step 1 Should understand)
- Test: `tests/dispatch-named-form-exclusion-reasons.test.js` (append one test)

**Interfaces:**
- Consumes: the test file's existing `REMOVING_REASONS` array and the `readText` helper.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-named-form-exclusion-reasons.test.js`:

```js
test('the #3084 journey names every removing exclusion reason, with a matching count (#3103)', () => {
  const journey = readText(path.join(__dirname, '..', 'docs', 'journeys', 'learn-why-a-named-record-wont-dispatch-3084.md'));
  const success = journey.split('\n').find((l) => l.startsWith('**Success state:**'));
  const step1 = journey.split('\n').find((l) => l.startsWith('- **Should understand:** A record can carry every grant'));
  assert.ok(success && step1, 'journey anchor lines not found -- anchor out of sync with the live file');
  const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  assert.ok(step1.includes(`for ${COUNT_WORDS[REMOVING_REASONS.length]} reasons`), `Step 1 must say "${COUNT_WORDS[REMOVING_REASONS.length]} reasons"`);
  for (const reason of REMOVING_REASONS) {
    assert.ok(step1.includes(`\`${reason}\``), `journey Step 1 does not name the \`${reason}\` exclusion`);
    assert.ok(success.includes(`\`${reason}\``), `journey Success state does not name the \`${reason}\` exclusion`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: FAIL on the #3103 test, with `Step 1 must say "five reasons"`.

- [ ] **Step 3: Edit the journey**

In `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md`:
- `files:` frontmatter: add `  - plugin/skills/dispatch/blocked-exclusion-report.md` after the `open-pr-exclusion-report.md` line.
- Line 22: replace `removes candidates for four reasons (\`open-pr\`, \`not-spec-shaped\`, \`target-missing\`, \`shipped\`)` with `removes candidates for five reasons (\`blocked\`, \`open-pr\`, \`not-spec-shaped\`, \`target-missing\`, \`shipped\`)`.
- Line 14 (Success state): replace `\`open-pr\` with the PR number, \`target-missing\`, or \`shipped\`` with `` `blocked` with its open blocker(s), `open-pr` with the PR number, `target-missing`, or `shipped` `` (write the backticks literally).
- Origin section: append `- Updated during build of #3103: names \`blocked\`, the fifth removing exclusion, in Step 1 and the Success state; \`blocked-exclusion-report.md\` added to \`files:\``. If the journey has no `## Origin` section, skip this bullet.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md tests/dispatch-named-form-exclusion-reasons.test.js
git commit -m "Name all five removing exclusions in the #3084 dispatch journey — blocked was missing (#3103)"
```
