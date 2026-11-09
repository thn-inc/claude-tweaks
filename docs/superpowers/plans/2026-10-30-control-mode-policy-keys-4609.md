# Control-Mode Policy Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the fourteen inert policy keys every later human-in-control record reads, plus the one `isControlModeOn` comparison site.

**Architecture:** Thirteen flat keys are ordinary `POLICY_KEYS` rows, with one new optional `element` field that validates each entry of a `list`. `risk-path-globs` is a second block-style key, parsed by a pure function in `policy-schema.js` and resolved from `policy.yml` only.

**Tech Stack:** Node 18+, zero runtime deps, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T132109-spec-4609-4610/spec-4609/work/4609-spec.md`

## Global Constraints

- A repository that sets none of the new keys resolves every pre-existing key identically to before.
- Key names are frozen: `control-mode`, `acceptance-target`, `deploy-reach`, `deploy-command`, `deploy-live-workflow`, `deploy-version-url`, `dev-base-url`, `dev-test-account`, `deploy-wait-seconds`, `deploy-poll-seconds`, `owned-owners`, `trusted-authors`, `risk-categories`, `risk-path-globs`.
- Built-in risk slugs, verbatim: `migrations`, `auth`, `public-contract`, `irreversible-side-effect`.
- Every new row is `tier: 'advanced'`. The core tier is at its enforced cap of 12 (`tests/policy-schema-metadata.test.js`).
- No Manifesto levers in this record.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Never run `git stash`. Run suites in the foreground of your turn, with long output redirected to a file. Code under `plugin/bin/` uses no bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`).

**Recorded build-time rulings:**

- **AC 4a list form (decided by the user at plan review: keep the contract).** `_shared/policy-schema.md` line 15 says a configured list key resolves to the raw comma-separated string in both modes, and callers split on `,`; a probe of `--values merge-sensitive-paths` confirmed it. So `owned-owners: Thn-Inc,acme` prints `Thn-Inc,acme` on one line, not one login per line, and AC 1's "prints nothing" is one empty line. `[Thn-Inc, acme]` is rejected on the invalid-value path, because a bracket would otherwise become part of a login.
- **AC 4b not taken.** The `map` type is shallow and does hold list values, so `risk-path-globs` stays a real map and AC 1's `{}` holds. It needs its own block parser, since `parseFlatLines` ignores indented lines.
- **AC 5's conformance test is `tests/policy-key-naming.test.js:32-38`**, which requires a `| `key` |` row for every `POLICY_KEYS` key. No new pin is added; Task 1 Step 6 revert-proves it.
- **`risk-path-globs` list syntax (decided by the user at plan review: accept both).** Inline `auth: [a, b]` and a block sequence (`auth:` then `- a`) are both valid. A rejected block resolves to an empty map, so normal YAML must never fall into that path.
- **A `#` ends a flat value**, as `release-hook` already documents, because `parseFlatLines` cuts at any `#`. Changing the parser would change every key (AC 6), so the prose rows for `deploy-command` and the URL keys say so and a test pins it.
- **`policy-schema.md` headroom.** 48,716 B today against the 52,500 B rail. This plan may add at most 3,000 B (ceiling 51,716 B), which leaves about 800 B. #4618, #4623 and #4624 also touch this file and must plan for that.

## Review Focus

- A hand-written YAML list `owned-owners: [a, b]`: rejected loudly, never read as logins `[a` and `b]`.
- A trailing comma or doubled comma in a list (`a,`, `a,,b`): rejected.
- A key after the `risk-path-globs:` block (`autonomy: trusted`): still parses, and is not swallowed into the block.
- A `risk-path-globs` key naming a slug from an invalid `risk-categories` value: rejected, so a typo cannot widen the map.
- `control-mode: ON`: invalid, resolves `off`, and `isControlModeOn('ON')` is false.

---

### Task 1: Flat keys, list element validation and the comparison helper

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (rows near `autonomy` line 157 and `merge-sensitive-paths` line 76, `isValidValue` lines 378-411, exports)
- Modify: `plugin/bin/lib/policy.js` (`isControlModeOn`, exports)
- Modify: `plugin/skills/_shared/policy-schema.md` (new `## Control mode` section, placed per Step 5)
- Modify: `tests/policy-schema.test.js:145-146` (key-count pin 84 → 97, one comment line in the existing style)
- Create: `tests/resolve-policy-control-mode.test.js`
- Waived `plugin/bin/resolve-policy.js`: Task 1's CLI tests read it; Task 2 changes it.

**Interfaces:**
- Produces: `BUILTIN_RISK_CATEGORIES` (array of the four slugs), exported from `policy-schema.js`.
- Produces: `isControlModeOn(value: unknown) -> boolean`, exported from `policy.js`, strictly `value === 'on'`.
- Produces: schema field `element: 'login' | 'slug'` on `list` rows.

- [ ] **Step 1: Write the failing tests** in `tests/resolve-policy-control-mode.test.js`

Use `resolve-policy-cli.test.js`'s harness shape: a temp dir with `git init`, `.claude-tweaks/policy.yml` written per test, `spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })`.

Tests, each pinned to the literal values shown:

```js
test('AC1.1: with no keys set, control-mode, acceptance-target and deploy-reach print their defaults', ...) // off, local, none
test('AC1.2: each empty list key prints one empty line and exits 0, like merge-sensitive-paths', ...) // owned-owners, trusted-authors, risk-categories -> '\n', status 0
test('AC1.4: deploy-wait-seconds prints 900 and deploy-poll-seconds prints 30', ...)
test('AC1.5: deploy-wait-seconds -1, deploy-poll-seconds 0 and non-integers take the invalid-value path', ...) // JSON invalid:true, value is the default
test('AC2.1: control-mode: on prints on', ...)
test('AC2.2: control-mode: maybe resolves off, flagged invalid, with one stderr warning, never on', ...) // same path as autonomy: maybe
test('AC3.1: acceptance-target: dev resolves', ...)
test('AC3.2: acceptance-target: staging is rejected', ...)
test('every string key returns its value; whitespace-allowed keys keep spaces and drop one matched pair of quotes', ...)
  // deploy-command: "npm run deploy:dev" -> npm run deploy:dev
  // deploy-live-workflow: Deploy to dev -> Deploy to dev
  // dev-test-account: dev smoke user -> dev smoke user
  // dev-base-url: https://dev.example.com -> same
test('AC4.6: owned-owners and trusted-authors round-trip a populated list in the raw comma-separated contract form, casing preserved', ...) // Thn-Inc,acme -> "Thn-Inc,acme\n"
test('AC4.7: list elements failing the login rule are rejected', ...)
  // each of: "", @acme, acme/repo, has space, {a: 1}, [Thn-Inc, acme], a, / a,,b -> invalid:true, value []
test('login rule accepts a bot login and an underscore login', ...) // dependabot[bot], user_corp
test('AC4.8: isControlModeOn is true only for the exact string on', ...) // 'on' true; 'ON','yes',undefined,true false
test('risk-categories accepts extra slugs and rejects a non-slug', ...) // data-export,pii ok; Data_Export invalid
test('deploy-command is cut at a # like every flat value', ...)  // curl https://x/#y -> curl https://x/
test('URL keys require http(s) and reject a quoted value', ...)  // https://dev.example.com ok, http://localhost:3000 ok; "https://x", not-a-url, has space -> invalid
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/resolve-policy-control-mode.test.js`
Expected: FAIL (`control-mode` reports `unknown-key`, `isControlModeOn` is not a function)

- [ ] **Step 3: Add the rows, validation and helper**

Thirteen rows. `control-mode`, `owned-owners`, `trusted-authors` take `category: 'autonomy-trust'`; `risk-categories` takes `merge-safety`; the rest take `pipeline-behavior`.

| Key | Shape |
|---|---|
| `control-mode` | `enum`, `['off','on']`, default `off` |
| `acceptance-target` | `enum`, `['local','dev']`, default `local` |
| `deploy-reach` | `enum`, `['on-merge','command','none']`, default `none` |
| `deploy-command`, `deploy-live-workflow`, `dev-test-account` | `string`, no default, `allowWhitespace: true` |
| `deploy-version-url`, `dev-base-url` | `string`, no default, `pattern: /^https?:\/\/\S+$/` |
| `deploy-wait-seconds` | `integer`, `min: 0`, default `900` |
| `deploy-poll-seconds` | `integer`, `min: 1`, default `30` |
| `owned-owners`, `trusted-authors` | `list`, default `[]`, `element: 'login'` |
| `risk-categories` | `list`, default `[]`, `element: 'slug'` |

Summary strings are limited by `tests/policy-schema-metadata.test.js:20-21`: at most 140 characters, never containing the row's own key, and never repeated verbatim in the prose table. Use these two literally:
- `control-mode`: `The single human-in-control switch; implied levers default at skill-default precedence, so any explicitly set lever wins.`
- `deploy-command`: `Executed string, read only from the base branch's policy; meaningful only with deploy-reach command and control mode on.`

Every other summary says it is read only with control mode on and names its pairing: `acceptance-target` with `deploy-reach` when `dev`; `deploy-reach` with `acceptance-target: dev`; `deploy-live-workflow` and `deploy-version-url` with `deploy-reach` other than `none`; `dev-base-url` with `acceptance-target: dev`; `dev-test-account` with `dev-base-url`; `deploy-wait-seconds` with a live signal; `deploy-poll-seconds` with `deploy-wait-seconds`; `risk-categories` with `risk-path-globs`; `owned-owners` and `trusted-authors` pair with nothing.

`isValidValue`'s `string` case also requires `schemaEntry.pattern` to match when one is set.

`isValidValue`'s `list` case: when `schemaEntry.element` is set, split on `,`, trim, and require every element to match. `login`: `/^[A-Za-z0-9][A-Za-z0-9_-]*(\[bot\])?$/`. `slug`: `/^[a-z0-9][a-z0-9-]*$/`. A `list` row with no `element` still returns true unchanged. `opaque` keeps its own unconditional `true`.

- [ ] **Step 4: Update the key-count pin** in `tests/policy-schema.test.js` to 97, with a comment line in the existing style.

- [ ] **Step 5: Add the prose section** to `plugin/skills/_shared/policy-schema.md`, placed immediately before `## Additional levers`.

`## Control mode`, then one short paragraph naming: skill-default precedence (an explicit lever wins, `autonomy` unchanged), consulted-only-when-on, the four built-in slugs, list entries as logins compared case-insensitively by consumers, that `isControlModeOn` in `bin/lib/policy.js` is the one comparison site, and that a `#` ends a value and URL keys are written unquoted. Add a `| Control mode | `autonomy-trust` |` row to the section mapping table under `## Metadata fields`. Then a five-column table in the file's shape with one compact row per key. Owner skill column reads `none yet (#4608)`. Whole section under 3,000 B including Task 2's row.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/resolve-policy-control-mode.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-cli.test.js tests/policy.test.js`
Expected: PASS, 0 failures

Then `wc -c plugin/skills/_shared/policy-schema.md`. Expected: at most 51,716.

Guard discrimination, in a scratch `git worktree add`: deleting the `element` check turns `AC4.7` red; changing `isControlModeOn` to `value !== 'off'` turns `AC4.8` red; deleting the `pattern` check turns the URL test red; removing the new `control-mode` row from `policy-schema.md` turns `tests/policy-key-naming.test.js` red (AC5.1, AC5.2).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy.js plugin/skills/_shared/policy-schema.md tests/policy-schema.test.js tests/resolve-policy-control-mode.test.js
git commit -m "Add control-mode policy keys — thirteen inert flat keys and isControlModeOn, refs #4609"
```

### Task 2: The `risk-path-globs` block key

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (row, `parseRiskPathGlobs`, a branch in `resolvePolicyKeys` beside the `model-profiles` branch at line 529, `auditPolicy`, exports)
- Modify: `plugin/bin/resolve-policy.js:112-116` (`--values` rejection, header comment)
- Modify: `plugin/skills/_shared/policy-schema.md` (one row, and line 15's scalar-form sentence)
- Modify: `tests/policy-schema.test.js` (count 97 → 98)
- Test: `tests/resolve-policy-control-mode.test.js`

**Interfaces:**
- Consumes: `BUILTIN_RISK_CATEGORIES`, the `risk-categories` row.
- Produces: `parseRiskPathGlobs(policyRaw: string|null, extraSlugs: string[]) -> { present: false } | { present: true, ok: true, value: {[slug]: string[]} } | { present: true, ok: false, raw: string }`, exported from `policy-schema.js`.
- Produces: `resolvePolicyKeys(['risk-path-globs'], …)` returning `{ value: {…}, source: 'policy' }`, `{ value: {}, source: 'default' }`, or `{ value: {}, source: 'default', invalid: true }`.

- [ ] **Step 1: Write the failing tests**

Policy shape under test, both list forms:

```yaml
risk-path-globs:
  migrations: [migrations/**, db/schema.rb]
  auth: ["src/auth/**"]   # trailing comment
  public-contract:
    - openapi/**
    - "sdk/**"   # trailing comment
autonomy: trusted
```

```js
test('AC1.3: risk-path-globs is {} in JSON when unset, and --values rejects it with no scalar form', ...) // exit 1, stderr names the key
test('AC4.1: risk-path-globs accepts a slug-to-glob-list map and round-trips unchanged', ...)
  // deepEqual {migrations:['migrations/**','db/schema.rb'], auth:['src/auth/**'], 'public-contract':['openapi/**','sdk/**']}, source policy
test('the same block with CRLF line endings parses identically', ...)
test('a key after the block still parses', ...)                 // autonomy resolves trusted, source policy
test('AC4.2: risk-categories accepts extra slugs usable as map keys', ...) // risk-categories: pii + pii: [x/**]
test('AC4.3: an unknown slug is rejected', ...)                 // nope: [a] -> invalid:true, value {}
test('a slug from an invalid risk-categories value is rejected', ...) // risk-categories: Bad_Slug + Bad_Slug: [a]
test('AC4.4: a non-list value is rejected', ...)                // auth: src/**, auth: (empty, no sequence after it), risk-path-globs: x inline, a `- x` line under a row that already has an inline list
test('AC4.5: a non-string glob is rejected', ...)               // auth: [1], [true], [null], and the same values as `- 1` sequence items
test('a nested list, an empty element, an unbalanced brace and a duplicate slug are rejected', ...)
  // auth: [[a]] ; auth: [a,,b] ; auth: [src/{a,b}/**] ; auth twice ; an empty `- ` item
test('an empty glob list is valid', ...)                        // auth: [] -> {auth: []}
test('--values model-profiles still errors with its existing message', ...)
test('auditPolicy reports an invalid block once, and nothing for a valid one', ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/resolve-policy-control-mode.test.js`
Expected: FAIL (`risk-path-globs` reports `unknown-key`)

- [ ] **Step 3: Implement**

Schema row: `{ key: 'risk-path-globs', type: 'map', keys: BUILTIN_RISK_CATEGORIES, default: {}, summary, category: 'merge-safety', tier: 'advanced' }`. The summary names the block shape and says it is consulted only when `control-mode` is `on`.

`parseRiskPathGlobs`:
1. Find a column-0 line `risk-path-globs:`. None: `{ present: false }`.
2. Anything other than a trailing comment after the colon is invalid (inline value).
3. Read following lines until the first non-blank, non-comment column-0 line, trimming each line's end first so CRLF parses. Strip a whitespace-preceded `#` comment. A row is `^\s+(slug):\s*(value)`. An empty value opens a block sequence: the `- item` lines that follow, indented deeper than the slug, are its elements.
4. Invalid when: a line is neither a row nor an item of an open sequence; a duplicate slug; the slug is not in `BUILTIN_RISK_CATEGORIES` or `extraSlugs`; a value is neither `[…]` nor an empty value opening at least one `- item`; an element is empty, starts with `[`, or has unbalanced `{`/`}`; an unquoted element is `true`, `false`, `null`, `~` or numeric. Strip one matched pair of quotes from an element with `stripMatchedQuotes`.

`resolvePolicyKeys` branch for `risk-path-globs`, before the `canonical` lookup: compute `extraSlugs` from `parseFlatLines(policyRaw)['risk-categories']` only when it passes `isValidValue`, otherwise `[]`. On invalid call `onInvalid(requested, raw)`. It never reads `runConfigRaw`: run configs hold flat lever lines.

`auditPolicy`: when the parser returns `ok: false` and the flat loop has not already flagged the key, push one `invalidValues` row.

`resolve-policy.js`: a `BLOCK_KEYS = ['model-profiles', 'risk-path-globs']` check in `--values` mode; the message keeps its existing wording with the key substituted.

- [ ] **Step 4: Sweep prose that says there is only one block key**

`git grep -n -i -E "one block-style|one nested-block|today, only model-profiles|model-profiles.*(no scalar form)" -- plugin tests`

Update each hit in `plugin/` so it stays true, including `policy-schema.md` line 15, its "Two carve-outs" `model-profiles is policy-only` bullet (add `risk-path-globs`, which never reads `--run`), `resolve-policy.js`'s header comment and `policy-schema.js`'s comments at `parseFlatLines`, `resolvePolicyKeys`, `extractMapEntry` and `auditPolicy`. Classify each `tests/` hit as re-pointed or no-change in the commit body. Also check the bucket and count forms: `git grep -n -E "block-style|nested block" -- plugin/skills/_shared`, and `git grep -n -E "\b84\b" -- tests/policy-schema.test.js`.

- [ ] **Step 5: Add the prose row, update the count pin to 98**

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/resolve-policy-control-mode.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-cli.test.js tests/policy.test.js tests/bin-lib/model-profiles/policy-keys-registration.test.js`
Expected: PASS, 0 failures

Then `wc -c plugin/skills/_shared/policy-schema.md`. Expected: at most 51,716.

Guard discrimination, in a scratch `git worktree add`: deleting each of the slug check, the bracket check and the non-string check turns its own named test red; the row-end rule (step 3.3) turns `a key after the block still parses` red when removed.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/resolve-policy.js plugin/skills/_shared/policy-schema.md tests/policy-schema.test.js tests/resolve-policy-control-mode.test.js
git commit -m "Add risk-path-globs block key — slug-to-glob map resolved from policy.yml, refs #4609"
```

## Acceptance coverage notes

Waived AC5.1: the existing `tests/policy-key-naming.test.js` pin, proven by Task 1 Step 6's row removal.
Waived AC4.9: the fallback is not taken; see the recorded AC 4b ruling.
Waived AC4.10: the same ruling.
Waived AC6.1: covered by running the pre-existing policy suites unchanged in both tasks' Step 6 and the full run at Common Step 5; the count pin is the one permitted edit.
Waived AC7.1: `npm test` is Common Step 5's full run.
Waived _shared/auto-mode-contract.md: no key here is a Manifesto lever, so its checklist does not apply.
Waived .claude-tweaks/policy.yml: named by the spec only as the file shape; tests write their own fixture.
