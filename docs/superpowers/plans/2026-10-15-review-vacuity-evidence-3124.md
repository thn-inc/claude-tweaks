# Review lens 3f vacuity evidence (#3124) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/review` from auto-deleting test cases on a "these tests are vacuous" finding that no agent actually ran.

**Architecture:** Prose-only change to two review sub-files plus one row qualifier in the auto-mode contract, pinned by one new conformance test. No code change to `review-coordination.js`. Lens 3f gets an execution-evidence rule for vacuity claims, a post-`categorise-reproduction` downgrade enforces it, and Step 3 Routing gets a test-removal override that keeps such fixes out of AUTO at every ceiling.

**Tech Stack:** Markdown skill files; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T174025-spec-3124/work/3124-spec.md` (materialized from GitHub issue #3124)

**Scope keywords:** vacuity, vacuous, test-removal

## Global Constraints

- Insert new prose **outside** the "Per-lens Calibration + Output template" fenced block in `step3-lens-dispatch.md`; that block must stay byte-identical to `_shared/criteria-review-quality.md`.
- Do not change `step3-debate-and-refutation.md` (the Refutation Pass's `medium` floor is deliberately left alone).
- Execution evidence means an observed result: the command and its actual output, or the mutation and the passing run. A bare "I ran it and it was empty" does not count.
- The downgrade applies at every tier where lens 3f produces a `confirmed` finding (it is in scope at `medium` too).
- Test-removal fixes route STAGED at every ceiling (`none`, `low`, `medium`), overriding the prose-exempt bump; Critical stays KEPT-PROMPT.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #3124` (never a closing keyword), ending with `Claude-Session: https://claude.ai/code/session_015v2PfCEG5K3Mz19kTxnThQ`.

## Review Focus

- A vacuity finding phrased differently ("passes trivially", "asserts nothing", "can never fail") — the rule must be stated by substance, not by one keyword.
- A fix that removes test lines but adds others (net deletion of cases/assertions) — the override keys on net removal of cases or assertion lines, read from the diff.
- A prose-only fix to a `skills/**/*.md` file that also deletes a test file's case — the override must beat the prose-exempt bump (a mixed-path fix is already bump-ineligible, but the override must say it wins regardless).
- A vacuity finding at `medium` effort (3f in scope, pair dispatched) — the downgrade must not read as `high`-only.
- The Direct-verification override path — reading source alone must not re-confirm a downgraded vacuity finding; only running the case does.

---

### Task 1: Lens 3f vacuity-evidence rule and post-categorisation downgrade

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (§ "3f: Test Quality": new bullet directly after the Discrimination diagnostic; Reproduction dispatch blockquote: new bullet directly after the "Findings present in only one agent's output" bullet)
- Modify: `plugin/skills/review/step3-routing.md` (the "`unconfirmed` findings can originate from several sources" list: new bullet after the Low-tier single-read bullet)
- Test: `tests/review-vacuity-evidence-conformance.test.js` (create)

**Interfaces:**
- Produces: the test file `tests/review-vacuity-evidence-conformance.test.js` with helpers `sectionOf(md, heading)` (returns text from a `### `/`## ` heading to the next heading of the same or higher level) used again by Task 2.

- [ ] **Step 1: Write the failing test** — create `tests/review-vacuity-evidence-conformance.test.js`:

```js
'use strict';
// tests/review-vacuity-evidence-conformance.test.js — pins #3124's two
// review rules: lens 3f vacuity claims need execution evidence (and a
// pair-agreed one without it is downgraded to unconfirmed), and a fix that
// removes test cases or assertions never auto-applies.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const lensDispatch = fs.readFileSync(path.join(REVIEW, 'step3-lens-dispatch.md'), 'utf8');
const routing = fs.readFileSync(path.join(REVIEW, 'step3-routing.md'), 'utf8');

function sectionOf(md, heading) {
  const start = md.indexOf(`\n${heading}\n`);
  assert.ok(start !== -1, `heading not found: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = md.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

test('lens 3f carries a vacuity-evidence diagnostic requiring observed execution', () => {
  const lens3f = sectionOf(lensDispatch, '### 3f: Test Quality');
  const line = lens3f.split('\n').find((l) => /Vacuity-evidence diagnostic/.test(l));
  assert.ok(line, 'lens 3f must carry a **Vacuity-evidence diagnostic** bullet');
  assert.match(line, /cannot fail/);
  assert.match(line, /vacuous/);
  assert.match(line, /observed/);
  assert.match(line, /mutat/);
  assert.match(line, /docstring/);
});

test('the vacuity bullet sits directly after the Discrimination diagnostic', () => {
  const lens3f = sectionOf(lensDispatch, '### 3f: Test Quality');
  const bullets = lens3f.split('\n').filter((l) => l.startsWith('- '));
  const disc = bullets.findIndex((l) => /Discrimination diagnostic/.test(l));
  assert.ok(disc !== -1, 'Discrimination diagnostic bullet must exist');
  assert.match(bullets[disc + 1], /Vacuity-evidence diagnostic/);
});

test('the Reproduction dispatch section downgrades an unevidenced lens 3f vacuity finding', () => {
  const lines = lensDispatch.split('\n');
  const idx = lines.findIndex((l) => /^> - \*\*Lens 3f vacuity findings need execution evidence/.test(l));
  assert.ok(idx !== -1, 'Reproduction dispatch blockquote must carry the lens 3f downgrade bullet');
  const bullet = lines[idx];
  assert.match(bullet, /categorise-reproduction/);
  assert.match(bullet, /`unconfirmed`/);
  assert.match(bullet, /reproduction agreement overridden, no execution evidence/);
  assert.match(bullet, /Direct-verification override does not lift/);
  const onlyOne = lines.findIndex((l) => /^> - Findings present in only one agent's output/.test(l));
  assert.ok(onlyOne !== -1 && onlyOne < idx, 'the downgrade bullet must follow the reproduction bullets');
});

test('step3-routing lists the lens 3f no-execution-evidence source among unconfirmed sources', () => {
  const start = routing.indexOf('**`unconfirmed` findings can originate from several sources**');
  assert.ok(start !== -1, 'unconfirmed-sources list must exist');
  const list = routing.slice(start, routing.indexOf('**Effort-tier surfacing.**', start));
  assert.match(list, /^- Vacuity claim without execution evidence \(lens 3f/m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-vacuity-evidence-conformance.test.js`
Expected: FAIL — 4 failing tests (no Vacuity-evidence diagnostic, no downgrade bullet, no unconfirmed source).

- [ ] **Step 3: Implement**

In `plugin/skills/review/step3-lens-dispatch.md`, § "3f: Test Quality", insert directly after the `- **Discrimination diagnostic (new regression tests):** …` bullet:

```markdown
- **Vacuity-evidence diagnostic (claims that a test cannot fail):** a finding whose substance is "this test cannot fail", "these cases are vacuous", or "this passes trivially" makes the opposite claim to the Discrimination diagnostic above, and needs the same kind of proof. Its Evidence field must show execution: the case run with its actual observed output (the command and what it printed), or the code under test mutated and the test shown staying green (the mutation and the passing run). A comment, a docstring, a fixture name, or a reading of the code is not evidence for this claim, and neither is "I ran it and it was empty" with no output shown. A vacuity finding without that evidence is downgraded after reproduction (the Reproduction dispatch section's lens 3f bullet). (#3124: a pair took a wrong fixture docstring at face value, and the auto-applied fix deleted five valid parametrized cases.)
```

In the same file's Reproduction dispatch blockquote, insert directly after the `> - Findings present in only one agent's output → emit as \`unconfirmed\`. …` bullet:

```markdown
> - **Lens 3f vacuity findings need execution evidence, whatever the pair agreed.** After `categorise-reproduction` returns, check every `confirmed` lens 3f finding whose substance is "this test cannot fail" or "these cases are vacuous / pass trivially". When neither agent's Evidence field shows execution evidence (an observed run with its output, or a mutation that left the test green — lens 3f's Vacuity-evidence diagnostic), downgrade it to `unconfirmed`: two agents reading the same misleading comment share the same misread, so pair agreement is not evidence for this claim. Write: `STAGED {HH:MM:SS} — Reproduction: lens "3f" vacuity finding {path}:{line} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. Reversibility: high.` This applies at every tier where lens 3f produces a `confirmed` finding (`medium` and above). The Direct-verification override does not lift this downgrade by reading source alone: the only way back to `confirmed` is the reviewing agent running the case itself and recording the command and its observed output in the confirmation log line.
```

In `plugin/skills/review/step3-routing.md`, in the "`unconfirmed` findings can originate from several sources" list, insert directly after the `- Low-tier single-read (Step 3, …)` bullet:

```markdown
- Vacuity claim without execution evidence (lens 3f, Step 3) — a pair-agreed `confirmed` finding that a test "cannot fail" or that cases "are vacuous", downgraded because neither agent showed an observed run or a mutation that stayed green (`step3-lens-dispatch.md`'s Reproduction dispatch section). Reading source alone never re-confirms it; only the reviewing agent running the case and recording the observed output does.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-vacuity-evidence-conformance.test.js tests/review-dispatch-composition.test.js tests/step3-routing-prose-exempt-conformance.test.js`
Expected: PASS (all).

Also confirm the calibration block is untouched: `node --test tests/code-health-misc/criteria-fragments.test.js` — Expected: PASS (it pins the CALIBRATION block byte-identity).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-routing.md tests/review-vacuity-evidence-conformance.test.js
git commit -m "Require execution evidence for lens 3f vacuity findings — refs #3124"
```

---

### Task 2: Test-removal fixes never auto-apply

**Files:**
- Modify: `plugin/skills/review/step3-routing.md` (Auto mode section: new bold paragraph after the prose-exempt paragraph; one sentence after the ceiling-keyed table)
- Modify: `plugin/skills/_shared/auto-mode-contract.md:171` (the `/review` Step 3 Routing row: append the override qualifier)
- Test: `tests/review-vacuity-evidence-conformance.test.js` (extend)

**Interfaces:**
- Consumes: `sectionOf`, `routing` from Task 1's test file.

- [ ] **Step 1: Write the failing tests** — append to `tests/review-vacuity-evidence-conformance.test.js`:

```js
const contract = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'auto-mode-contract.md'), 'utf8');

test('step3-routing states test-removal fixes route STAGED at every ceiling, over the prose-exempt bump', () => {
  const auto = sectionOf(routing, '## Auto mode (severity-based routing)');
  const para = auto.split('\n').find((l) => l.startsWith('**Test-removal fixes never auto-apply.**'));
  assert.ok(para, 'Auto mode must carry a **Test-removal fixes never auto-apply.** paragraph');
  for (const ceiling of ['`none`', '`low`', '`medium`']) assert.ok(para.includes(ceiling), `must name ceiling ${ceiling}`);
  assert.match(para, /STAGED/);
  assert.match(para, /prose-exempt bump/);
  assert.match(para, /KEPT-PROMPT/);
  assert.match(para, /test-removal override — staged/);
  const prose = auto.indexOf('Also resolve `review-auto-apply-prose-exempt`');
  assert.ok(prose !== -1 && prose < auto.indexOf(para), 'the override follows the prose-exempt paragraph');
});

test('the ceiling-keyed table is followed by a pointer to the test-removal override', () => {
  const auto = sectionOf(routing, '## Auto mode (severity-based routing)');
  const after = auto.slice(auto.indexOf('| **Low** |'));
  const nextPara = after.split('\n\n')[1];
  assert.match(nextPara, /test-removal override/);
});

test('the auto-mode contract row for /review Step 3 Routing names the test-removal override', () => {
  const row = contract.split('\n').find((l) => l.startsWith('| Code review findings (`/review` Step 3 Routing)'));
  assert.ok(row, 'contract row must exist');
  assert.match(row, /removes test cases or assertions/);
  assert.match(row, /STAGED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-vacuity-evidence-conformance.test.js`
Expected: FAIL — the 3 new tests fail; Task 1's 4 pass.

- [ ] **Step 3: Implement**

In `plugin/skills/review/step3-routing.md`, insert as its own paragraph directly after the `Also resolve \`review-auto-apply-prose-exempt\` …` paragraph (before the `Per the \`/review\` Step 3 Routing row …` paragraph):

```markdown
**Test-removal fixes never auto-apply.** When a finding's fix removes test cases, parametrized rows, or assertions — read from the staged-patch diff itself: whole cases or assertion lines deleted from a test file, net — route it STAGED at every `review-auto-apply-ceiling` value (`none`, `low`, `medium`), overriding both the plain ceiling and the prose-exempt bump above. Critical still routes KEPT-PROMPT. A deleted test is a deleted oracle: if the finding behind it is wrong, nothing is left that would fail to show it (#3124). Log the override with `--lever "review-auto-apply-ceiling={ceiling} ({source}); test-removal override — staged"`, rendering `[lever: review-auto-apply-ceiling=medium (run-config); test-removal override — staged]`.
```

Directly after the table's following paragraph (`Critical never varies by ceiling — …`), append one sentence to that same paragraph:

```markdown
 The test-removal override above takes precedence over every AUTO cell in this table: a fix that removes test cases or assertions is STAGED (KEPT-PROMPT when Critical) at every ceiling.
```

(So the paragraph immediately after the table names the test-removal override — what Step 1's second test pins.)

In `plugin/skills/_shared/auto-mode-contract.md`, line 171, replace the final cell
`Severity:low → \`AUTO\`; severity:medium → \`STAGED\`; severity:high → \`STAGED\`; severity:critical → \`KEPT-PROMPT\` (rare — security/correctness hard-fails the bookend) |`
with
`Severity:low → \`AUTO\`; severity:medium → \`STAGED\`; severity:high → \`STAGED\`; severity:critical → \`KEPT-PROMPT\` (rare — security/correctness hard-fails the bookend); a fix that removes test cases or assertions → \`STAGED\` at every ceiling (\`review/step3-routing.md\`'s test-removal override) |`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-vacuity-evidence-conformance.test.js tests/step3-routing-prose-exempt-conformance.test.js tests/review-dispatch-composition.test.js`
Expected: PASS (all 7 new tests plus the existing suites).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-routing.md plugin/skills/_shared/auto-mode-contract.md tests/review-vacuity-evidence-conformance.test.js
git commit -m "Route test-removal review fixes STAGED at every ceiling — refs #3124"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 (vacuity bullet); Deliverable 2 → Task 1 (downgrade bullet, log line, Direct-verification exclusion); Deliverable 3 → Task 1 (unconfirmed source); Deliverable 4 → Task 2 (override paragraph, table pointer) plus the contract row named in Key Files; Deliverable 5 → both tasks' tests. AC "replaying the observed scenario" → walk-through: low 3f vacuity finding, pair-agreed from a docstring, `high`, ceiling `medium` → Task 1's downgrade makes it `unconfirmed` → Low-confidence subsection, never routed, so nothing auto-deletes; and even if confirmed, Task 2 stages it. AC "reverting either rule turns it red" → each task's Step 2 run is the red evidence. AC `npm test` full → central verification.
- **Placeholders:** none.
- **Type consistency:** `sectionOf`/`routing` defined in Task 1, consumed in Task 2.
- **Review Focus:** substance-not-keyword (bullet text lists three phrasings); net removal (paragraph says "net"); bump precedence (paragraph and test); `medium` tier (downgrade bullet names `medium` and above); Direct-verification (bullet and test).
