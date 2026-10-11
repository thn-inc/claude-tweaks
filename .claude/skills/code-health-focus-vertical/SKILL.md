---
name: code-health-focus-vertical
description: Use when adding a `/code-health focus=<vertical>` candidate generator — every registration site, the require-order and anchor rules, and the real-input fixtures it needs. Keywords - focus vertical, registerGenerator, FOCUS_GENERATORS, criteria fragment.
---

# Code-health focus vertical

`plugin/skills/code-health/focus-mode.md` owns the *runtime* procedure for a `focus=<vertical>` firing. This skill owns the *build* procedure for adding a vertical: every site a new key must land in, and the four mistakes #2693 (`focus=prelaunch`, the sixth vertical) made after its implementer reported DONE. Task review caught one; an opus whole-branch review caught the rest (9 findings, 3 important), all fixed before PR #2850 merged.

## The registration set

A vertical is not shipped until every row below lands in the same change. A key missing from either `focus-mode.md` table is a fail-loud stop at runtime, or a firing that reports a reach it never had.

| Site | What it gets |
|---|---|
| `plugin/bin/lib/code-health/candidates-{vertical}.js` | The generator, with a **Coverage** block in its module header naming what it cannot see |
| Same file | `registerGenerator('{vertical}', fn)` at require time |
| `plugin/bin/lib/code-health/focus-generators.js` | One autoload `require('./candidates-{vertical}')` line, after the existing ones |
| `plugin/bin/lib/code-health/criteria.js` | A criterion entry (`id`, `appliesTo`, `confidenceFloor`, `fragment`) |
| `plugin/skills/_shared/criteria-{vertical}.md` | The judge's fragment, unless the entry is `fragment: null` |
| `focus-mode.md` `## Coverage` | A pointer to the new generator's Coverage block |
| `focus-mode.md` `## Criterion pinning` | One `` | `{focus}` | `{criterion}` | `{fragment}` | `` row |
| `docs/getting-started.md` | The `/claude-tweaks:code-health` entry counts and names every shipped vertical |
| `tests/bin-lib/code-health/candidates-{vertical}.test.js` | Generator tests (see the test matrix below) |
| `focus-mode.md` `## F2` | Only for a generator that sets `notApplicable: true` (with its `notApplicableReason`): an exact `` focus={vertical}: not applicable — {reason} `` line and a stop, as `prelaunch`, `agent-trust-scope` and `app-store-readiness` have. Without it the firing falls through to the generic "no candidates" line and reads as a clean pass. #2628 missed this row |

`tests/code-health-prelaunch-wiring.test.js` asserts that the pinning table and `FOCUS_GENERATORS` name exactly the same foci, in both directions. It catches a missing pinning row. It does not catch a missing Coverage pointer, fragment, or getting-started entry, so check those by hand.

**Two more rows, only for a vertical that also participates in `/review`** (`security-hardening` #2624 and `agent-trust-scope` #2749 both do; `dead-code`/`abstraction-police`/`test-hygiene`/`experiment-cleanup`/`prelaunch` don't — this is a per-vertical decision, not every shipped vertical's obligation):

| Site | What it gets |
|---|---|
| `plugin/skills/review/code-mode-steps.md` | A new Step 6.X pass mirroring the existing Step 6.6 pattern (pre-check, invocation, result-handling table, Routing line), plus an update to every sibling Step 6.5/6.6/6.7 "Routing (optional)" sentence and the Step 6.7 heading/category table so they name the new step |
| `plugin/skills/review/review-summary-template.md` | A new summary section mirroring Step 6.6's (Include/Omit conditions, a findings table, an advisory footnote) |

A wiring test for this pair follows the same shape as the generator-registration test above — see `tests/code-health-agent-trust-scope-wiring.test.js` for the worked example (it also pins the `docs/getting-started.md` vertical count, so one test file covers both halves of the registration set).

## Extending an existing vertical

Adding a candidate `kind` to a shipped generator adds no `FOCUS_GENERATORS` key, so `tests/code-health-prelaunch-wiring.test.js` has nothing to catch, and no test pins the prose kind lists to the generator's emitted literals. Derive the site list by grepping an existing kind of that vertical across `plugin/` (`grep -rln 'unguarded-ai-endpoint' plugin` for `security-hardening`), then update every hit in the same change:

| Site | What it gets |
|---|---|
| The generator's module header | The new check in its check list, plus a Coverage bullet for it |
| `plugin/skills/_shared/criteria-{vertical}.md` | The `kind` list, a What-to-flag and a What-NOT-to-flag entry, a Severity calibration placement, and a copy-paste prompt where the fragment has that section |
| `plugin/skills/review/review-summary-template.md` (`/review` verticals only) | The new kind in that vertical's section's Kind column |
| The vertical's Step 6.X pre-check in `plugin/skills/review/code-mode-steps.md` (`/review` verticals only) | A re-derivation of whether its path gate still admits the files the new check targets |

The last row is pitfall 5 one level up. Step 6.6 skips unless the diff touches a `CLIENT_DIR_RE` or `ROUTE_DIR_RE` path, but the #2657/#2666 JWT and secrets-lifecycle checks scan repo-wide because their targets (`src/auth/jwt.js`, `config/secrets.js`) match neither gate, so a review of a diff touching only those files never runs them.

## Five pitfalls

1. **Require `./focus-generators` before `./candidates-dead-code`.** The registry autoloads every vertical. A vertical that requires `candidates-dead-code` first, and is then loaded directly (as its own test does), gets a half-built exports object from Node's circular require, so the shared helpers bind to `undefined`. `candidates-abstraction-police.js`'s require block documents the order. #2693 shipped it reversed.
2. **A candidate's `file` must be a real file.** Code-health anchors are `relfile#Symbol`, and `areaId` is derived from the anchor's file. A site-level item with no file of its own (a missing `robots.txt`) anchors to a real file, such as the site's entry page as `{file}#{item id}`, never to a directory.
3. **Test against real framework inputs, not the plan's rules.** Tests written from the plan pin the plan. #2693's first tests passed while Nuxt, Astro and SvelteKit layouts were invisible to the generator and its alt-text scan skipped components. Only fixtures in each framework's real file layout exposed that.
4. **A generator that emits a status per item needs a reconciliation rule.** When the summary renders one checklist row per item, the fragment must tell the judge how a row's status follows from its verdicts (`criteria-prelaunch.md`: a `fail` whose candidates were all rejected becomes `pass (N rejected: {reason})`). Without it, the table and the filed findings contradict each other.
5. **A path-heuristic gate copied from a sibling check is not automatically correct for a new check's semantics.** `CLIENT_DIR_RE` excludes paths whose directory name suggests client code — right for `scanClientSecrets` (client-embedded secrets), but a framework convention can put server-side code under the same directory name (Next.js App Router's `src/app` holds both client and server files), so reusing the same gate for a check whose target is server-side behavior (JWT validation, credential-env access) silently reintroduces false negatives. #2666/#2657's review caught `scanJwtValidation`/`scanSecretsLifecycle` reusing `scanClientSecrets`'s gate this way; by the time it was caught, tests already pinned the exclusion as deliberate, so the fix was disclosing the limitation in the Coverage block, not a behavior change — cheaper to re-derive whether a copied gate fits the new check's own scanning intent *before* writing the test that pins it.

## Test matrix

Settle these before the plan is written:

- **Probe the repo's own shape for every "this repo has no X" premise.** #2693's plan assumed the repo had no pages; `git ls-files '*.html'` found 9 fixture files, and the first build flagged this repo as a website. A generator must skip test, fixture, example and build-output directories, and the plan must say how it decides a repo is in scope at all.
- **One fixture per input shape the Coverage block claims**, for example one per supported framework layout, plus one negative fixture (a repo the vertical does not apply to) that must return no candidates.
- **Prove each new test is red without its fix.** Revert the line under test and watch the test fail before trusting it.

## Anti-patterns

| Pattern | Why it fails here |
|---|---|
| Adding the `FOCUS_GENERATORS` key without both `focus-mode.md` rows | The firing stops fail-loud at runtime, or reports a reach its Coverage block never stated |
| Fixing the require order only in the file that failed | Every vertical loaded directly by its own test has the same exposure |
| Anchoring a site-level finding to a directory | `areaId` derivation and dedup expect a file |
| A heuristic generator with only synthetic fixtures | Real layouts (`app/`, `src/routes/`, `layouts/`) are where #2693's misses were |

## Evidence

- PR #2850 (record #2693): the whole-branch review fixes and the fixture-HTML false positive, recorded as rows 4 and 5 of that run's ledger, `docs/plans/2026-09-30-flow-spec-2704-2709-ledger.md`.
- Registry: `plugin/bin/lib/code-health/focus-generators.js`. Criteria: `plugin/bin/lib/code-health/criteria.js`. Runtime procedure: `plugin/skills/code-health/focus-mode.md`.
