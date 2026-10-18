# QA Step-Origin Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the QA dispatcher's URL resolution so absolute origins inside `navigate` steps follow `APP_URL` when they equal the story's own origin, and are flagged (skipped on worktree runs) when they point at another loopback server.

**Architecture:** Prose-only change in the dispatcher (`qa-prompts.md`), resolved before prompt assembly, so the serialized step YAML carries resolved URLs and the templates' no-sibling-file-references contract is untouched. The story schema (`stories/SKILL.md`) and the agent's step mapping (`qa-agent.md`) document `navigate` with `target` as its URL field. One new `node --test` prose conformance suite pins all of it, with go-red controls that run the same assertion functions against mutated text.

**Tech Stack:** Markdown skill prose; `node --test` + `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194130-record-3005/work/3005-spec.md`

Scope keywords: resolved_url

(`navigate` and `APP_URL` were probed as keywords and rejected: `navigate` matches unrelated browse/walkthrough prose, and `APP_URL`'s other hits — `dev-url-detection.md`, `qa-procedures.md`, `visual-review`, `wrap-up/verification-brief.md` — resolve or consume `APP_URL` itself, not story step URLs. `story-examples.md` already writes `target:` and needs no change.)

## Global Constraints

- Only `navigate` steps are in scope. A `fill` value that happens to be a URL is test input and must reach the form verbatim.
- Origin comparison uses `new URL(x).origin`, matching the existing `story.url` rule.
- Loopback hosts: `localhost`, `127.0.0.1`, `::1`, `*.localhost` — cite `qa-procedures.md`'s Target environment check rather than inventing a second definition.
- Worktree detection: `repoInfo(process.cwd()).isLinkedWorktree` (`_shared/dev-url-detection.md`).
- New skip reason token, exact: `unresolved-secondary-origin`.
- `target` is the canonical `navigate` URL field going forward; read `value` as a fallback for existing stories.
- Legacy-format stories (`workflow` string) are free text and not parsed — state this as a coverage limit.
- A skipped story's dependents follow the existing dependency rule (`qa-procedures.md`'s "If a story's dependency failed, mark the dependent story as SKIPPED").
- Byte budgets (shared ceiling 51,200 bytes; no file-specific pin found by `git grep -n -E "qa-prompts|stories/SKILL|qa-agent" -- tests`): `plugin/skills/test/qa-prompts.md` is 19,180 bytes (~32 KB headroom), `plugin/skills/stories/SKILL.md` is 36,828 bytes (~14 KB headroom). `plugin/agents/qa-agent.md` (30,676) is outside the skills corpus.
- Moved-prose pin check: `git grep -n -F` for "Resolve each story's dispatch URL", "Log the rewrite once per run", "mid-story navigation", "The `url:` field", "embedded origin rewritten" over `tests plugin docs` — hits only in the files this plan edits plus `qa-procedures.md:17` (which cites the "Resolve each story's dispatch URL against `APP_URL`" heading — keep that heading text byte-identical). No test pins these phrases.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3005` (never "closes"/"fixes"), ending with the `Claude-Session:` trailer.
- Revisit the worktree skip when #3082 ships secondary-server resolution — say so in the new prose.

## Review Focus

1. A story whose `story.url` is root-relative but whose `navigate` step pins `http://127.0.0.1:9999/...` — the story's own origin is then `APP_URL`'s, so the 9999 step is *not* same-origin and must be flagged, not rewritten. Pinned by the `AC1` block assertion "When `story.url` is root-relative, the story's own origin is `APP_URL`'s".
2. A `fill` step whose `value` is a URL — must not be rewritten. Pinned by the `fill` assertion in Task 1.
3. A legacy `workflow`-string story containing an absolute URL — not parsed; must be stated as a coverage limit, not silently implied as covered. Pinned in Task 1.
4. A non-loopback absolute origin in a `navigate` step (e.g. a public site) — dispatched unchanged, never flagged or skipped. Pinned in Task 1.
5. An existing story that writes its `navigate` URL under `value` instead of `target` — still resolved. Pinned in Task 1 (block names both fields) and Task 2 (schema names `target` canonical, `value` fallback).

---

### Task 1: Step-origin resolution in `qa-prompts.md`

**Files:**
- Modify: `plugin/skills/test/qa-prompts.md:66-73` (the "Resolve each story's dispatch URL against `APP_URL`" block and its "Log the rewrite once per run" paragraph)
- Create: `tests/qa-prompts-step-origin.test.js`

**Interfaces:**
- Produces: `tests/qa-prompts-step-origin.test.js` with helpers `read(rel)` (CRLF-normalized file read relative to the repo root), `between(text, startLiteral, endLiteral)` (returns the substring from `startLiteral` up to but excluding `endLiteral`; throws if either is missing), and `assertQaPromptsBlock(block)`. Task 2 appends to this same file and reuses `read` and `between`.
- Block boundaries the test uses (implementer must keep them): start `**Resolve each story's dispatch URL against \`APP_URL\`**`, end `**Canonical schema.**`.

- [ ] **Step 1: Write the failing test**

Create `tests/qa-prompts-step-origin.test.js` (header comment: `// #3005: QA dispatch resolves absolute origins inside navigate steps, not only story.url.`). Define `assertQaPromptsBlock(block)` asserting, each with its own message:

```js
assert.match(block, /`navigate`/);
assert.match(block, /`setup\.steps`/);
assert.match(block, /`story\.steps`/);
assert.match(block, /`teardown\.steps`/);
assert.match(block, /`target`[\s\S]{0,80}`value`|`value`[\s\S]{0,80}`target`/);           // both URL fields read
assert.match(block, /story's own origin/i);
assert.match(block, /When `story\.url` is root-relative, the story's own origin is `APP_URL`'s/);
assert.match(block, /navigate[\s\S]*path\/query\/fragment/);                              // same preservation rule for steps
assert.match(block, /`unresolved-secondary-origin`/);
assert.match(block, /SKIPPED[\s\S]{0,200}`unresolved-secondary-origin`|`unresolved-secondary-origin`[\s\S]{0,200}SKIPPED/);
assert.match(block, /worktree/i);
assert.match(block, /isLinkedWorktree/);
assert.match(block, /loopback[\s\S]{0,300}qa-procedures\.md|qa-procedures\.md[\s\S]{0,300}loopback/i); // cites the loopback set (a bare qa-procedures.md citation already exists at baseline)
assert.match(block, /Non-loopback origin[\s\S]{0,120}unchanged/i);
assert.match(block, /primary-checkout run[\s\S]{0,200}flag/i);
assert.match(block, /`fill`[\s\S]{0,200}verbatim/);                                       // fill URLs untouched
assert.match(block, /`workflow`[\s\S]{0,300}(not parsed|coverage limit)/i);               // legacy stories
assert.match(block, /#3082/);
// worked example (AC4)
assert.match(block, /http:\/\/127\.0\.0\.1:9999\/app/);
assert.match(block, /http:\/\/127\.0\.0\.1:9999\/reset/);
assert.match(block, /http:\/\/127\.0\.0\.1:4010\/__reset/);
assert.match(block, /APP_URL=http:\/\/localhost:54321/);
assert.match(block, /http:\/\/localhost:54321\/reset/);
assert.match(block, /4010[\s\S]{0,300}flagged/i);
// logging (Deliverable 3)
assert.match(block, /step origin/i);                                                     // rewrite-count line
assert.match(block, /flag line|flagged origins/i);
assert.match(block, /story ids/i);
```

Tests (names cite the AC clause ids `plan-audit.js --spec` reports):
- `test('AC1.1, AC4.1, AC4.2: qa-prompts.md URL-resolution block states the navigate step-origin rule and its worked example', …)` — `assertQaPromptsBlock(between(read('plugin/skills/test/qa-prompts.md'), START, END))`.
- `test('AC3.1: each qa-prompts assertion goes red when its prose is reverted', …)` — for each of these literals, remove every occurrence from the live block and `assert.throws(() => assertQaPromptsBlock(mutated))`: `` `unresolved-secondary-origin` ``, `` `teardown.steps` ``, `path/query/fragment`, `qa-procedures.md`, `http://127.0.0.1:4010/__reset`, `When \`story.url\` is root-relative`. The mutation loop is the go-red evidence: it runs the same `assertQaPromptsBlock` the positive test runs.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qa-prompts-step-origin.test.js`
Expected: FAIL — AC1 test fails on the first missing literal (`setup.steps`).

- [ ] **Step 2b: Check AC clause coverage**

Run: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.144.0/bin/plan-audit.js" docs/superpowers/plans/2026-10-17-qa-step-origin-resolution.md --spec .claude-tweaks/pipelines/2026-10-17T194130-record-3005/work/3005-spec.md`
Expected: `checkE.uncovered` names no AC1/AC3/AC4 clause (AC2 is Task 2; AC5 is the suite run).

- [ ] **Step 3: Edit `plugin/skills/test/qa-prompts.md`**

Keep the existing three `story.url` bullets and the `Use \`resolved_url\` everywhere below` sentence unchanged. After that sentence, add a bold-led paragraph **Resolve every `navigate` step's URL the same way.** that covers, in this order:
- Scope: every step with `action: navigate` in `setup.steps`, `story.steps`, and `teardown.steps`; its URL is `target`, falling back to `value` for older stories. Only `navigate` — a `fill` value that happens to be a URL is test input and reaches the form verbatim. Resolution happens before the step blocks are serialized, so the YAML the templates embed already carries resolved URLs.
- "The story's own origin" is `new URL(story.url).origin`; When `story.url` is root-relative, the story's own origin is `APP_URL`'s.
- Four cases as bullets: **Matches the story's own origin** → rewrite to `APP_URL`'s origin, preserving path/query/fragment (same rule as `story.url`); **Other loopback origin, worktree run** (`repoInfo(process.cwd()).isLinkedWorktree`) → mark the story `SKIPPED` with reason `unresolved-secondary-origin`, naming the origin; dependents follow `qa-procedures.md`'s existing dependency rule; **Other loopback origin, primary-checkout run** → dispatch unchanged and include the origin in the flag line; **Non-loopback origin** → dispatch unchanged. Loopback means the host set in `qa-procedures.md`'s Target environment check (`localhost`, `127.0.0.1`, `::1`, `*.localhost`).
- Why the worktree skip: a secondary server's port can't be assumed there; revisit when #3082 ships secondary-server resolution.
- Coverage limit: legacy `workflow`-string stories are free text and are not parsed — their URLs are not covered.
- Worked example (a short fenced block or bullets): story `url: http://127.0.0.1:9999/app`, `APP_URL=http://localhost:54321`; step `navigate` `target: http://127.0.0.1:9999/reset` resolves to `http://localhost:54321/reset`; step `target: http://127.0.0.1:4010/__reset` is flagged (and the story skipped with `unresolved-secondary-origin` on a worktree run).

Then extend the existing **Log the rewrite once per run** paragraph (keep its first sentence's meaning and the `QA: N stories had an embedded origin rewritten...` example): add one rewrite-count line for step origins (e.g. `QA: N navigate steps had their origin rewritten to APP_URL`) and one flag line listing the distinct flagged origins and the affected story ids (e.g. `QA: flagged secondary origins {origin, …} in stories {id, …}`), same destination rule (`log-decision.js` when a run dir is active, otherwise the QA report).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qa-prompts-step-origin.test.js tests/subagent-contract-clauses.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/qa-prompts.md tests/qa-prompts-step-origin.test.js
git commit -m "Resolve navigate step origins in QA dispatch — rewrite same-origin, flag other loopback

refs #3005"
```

---

### Task 2: Document `navigate` + `target` in the story schema and agent mapping

**Files:**
- Modify: `plugin/skills/stories/SKILL.md:35-64` (Story schema (v2) YAML example + "The `url:` field" paragraph)
- Modify: `plugin/agents/qa-agent.md:116` (the `navigate` bullet)
- Test: `tests/qa-prompts-step-origin.test.js` (append)

**Interfaces:**
- Consumes: `read(rel)`, `between(text, start, end)` from Task 1.
- Schema section boundaries: start `## Story schema (v2)`, end `## Auth Vault`. Agent bullet: the single line matching `/^\s*- `navigate`.*$/m`.

- [ ] **Step 1: Write the failing test**

Append to `tests/qa-prompts-step-origin.test.js`:
- `assertStoriesSchema(section)`: `assert.match(section, /- action: navigate\n\s+target: /)` (navigate step inside the YAML example); `assert.match(section, /`navigate`[\s\S]{0,300}`target`/)`; `assert.match(section, /`value`[\s\S]{0,200}(fallback|older)/i)`; `assert.match(section, /The `url:` field\.[\s\S]*`navigate` step/)` (url paragraph gains the step rule); `assert.match(section, /`unresolved-secondary-origin`/)`.
- `assertAgentNavigateBullet(line)`: `assert.match(line, /goto <target>/)`; `assert.match(line, /`target`/)`.
- `test('AC2.1: stories/SKILL.md schema documents action: navigate with target', …)` and `test('AC2.1: qa-agent.md navigate bullet names the target field', …)` on live text.
- `test('AC3.1: stories/qa-agent assertions go red when their prose is reverted', …)` — `assert.throws` on `assertStoriesSchema(section.replace(/- action: navigate\n\s+target: [^\n]*\n/, ''))`, on `assertStoriesSchema(section.replaceAll('`unresolved-secondary-origin`', ''))`, and on `assertAgentNavigateBullet(line.replace('<target>', '<url>'))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qa-prompts-step-origin.test.js`
Expected: FAIL — the AC2 tests fail (no `action: navigate` in the schema; bullet still says `goto <url>`).

- [ ] **Step 3: Edit both files**

`stories/SKILL.md`: add a `navigate` step to the schema's YAML example (e.g. first step `- action: navigate` / `target: "/cart"`), and one sentence after the locator paragraph: `navigate` takes no locator; its URL field is `target` (canonical, as in `story-examples.md`); older stories that wrote `value` are still read as a fallback. Extend "The `url:` field" paragraph with the step rule: an absolute origin inside a `navigate` step that equals the story's own origin is rewritten to `APP_URL`'s the same way; any other loopback origin is flagged, and on a worktree run the story is skipped as `unresolved-secondary-origin` — see `qa-prompts.md`'s dispatch step. Prefer root-relative `target`s.

`qa-agent.md:116`: change `goto <url>` to `goto <target>` and name the field: the step's `target` field (or `value` in older stories) supplies the URL, already resolved against `APP_URL` by the dispatcher. Keep the rest of the bullet.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qa-prompts-step-origin.test.js tests/stories-caption-expand-only.test.js tests/multispec-artifact-namespacing-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/stories/SKILL.md plugin/agents/qa-agent.md tests/qa-prompts-step-origin.test.js
git commit -m "Document navigate target field in story schema and qa-agent — align with step-origin rule

refs #3005"
```

---

Waived AC5.1: `npm test` passing is covered by `/build` Common Step 5's full-suite verification, not by a task's test step.

## As-built deviations (Common Step 4.5)

- **Beneficial — two cases ahead of the classification** (`c5e13b23e`, from the whole-branch review): a root-relative `target` joins to `APP_URL` (`new URL(target, APP_URL)`), and an absolute origin already equal to `APP_URL`'s stays unchanged — both never flagged. The spec's four cases covered absolute origins only, while Task 2's schema prose recommends root-relative `target`s; without these the recommended form was undefined, and an already-rewritten shared `setup.steps` URL could be re-classified as "other loopback".
- **Beneficial — `plugin/skills/test/qa-reporting.md`** (`c5e13b23e`): the report's Skipped section names the new `unresolved-secondary-origin: {origin}` reason, matching how `unacknowledged-remote-target` was added. Not in the spec's Key Files; the reason token would otherwise never reach the report's Skipped table.
- **Spec premise reversed — skip cascade** (`c5e13b23e`): the spec's Technical Approach says a skipped story's dependents "follow the existing dependency rule (`qa-procedures.md:89`)", but that rule fires only on a **failed** dependency. The prose instead states "its dependents cascade as `SKIPPED` (as with `missing-auth-vault`)". Staged for the Review Console as an "Update the spec" row.
