# resolve-policy --values: warn on stderr when a requested key's value is invalid (#4141) Implementation Plan

**Goal:** `plugin/bin/resolve-policy.js --values` writes one stderr warning per requested key whose resolved entry carries `invalid: true`, naming the key, the rejected value, and the default it fell back to. Stdout and the exit code stay unchanged.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T132741-record-4141/work/4141-spec.md` (materialized from GitHub issue #4141)

**Scope-creep note (policy `add-to-plan`):** the resolved entry `{ value: default, source: 'default', invalid: true }` does not carry the rejected raw value, and several suites pin that JSON entry shape with `deepStrictEqual` (`tests/resolve-policy-cli.test.js` AC 7, `tests/resolve-policy-lib.test.js`). So the rejected value is not added to the entry. Instead, `resolvePolicyKeys` / `resolvePolicyConfig` in `plugin/bin/lib/policy-schema.js` take an optional `onInvalid(key, raw)` callback, called at the one place an invalid value is rejected. The CLI collects from it. This adds to the API: callers that pass no callback see no change.

---

### Task 1: Warn on stderr for each invalid requested key in `--values` mode

**Files:**
- Modify: `plugin/bin/resolve-policy.js`
- Modify: `plugin/bin/lib/policy-schema.js`
- Create: `tests/fixtures/resolve-policy/run-config-invalid.yml`
- Test: `tests/resolve-policy-cli.test.js`

- [ ] **Step 1: Failing test** — in `tests/resolve-policy-cli.test.js`, add:
  - a `--values` case with `--run` pointing at a run config holding an invalid value (`trust-revert-window-days: banana`). It asserts stdout is the default (`14`), exit is 0, and stderr names the key and contains the word `invalid` and the rejected value `banana`.
  - a `--values` case with only valid keys that asserts stderr is empty. The existing `--values` tests already assert this for `policy-basic.yml`; the new case adds valid keys alongside a `--run` overlay to pin it explicitly.
- [ ] **Step 2: Implement**
  - `policy-schema.js`: `resolvePolicyKeys(requestedKeys, { policyRaw, runConfigRaw, onInvalid } = {})` calls `onInvalid(requested, raw)` when a present value fails `isValidValue` (the existing `invalid: true` branch). `resolvePolicyConfig` forwards an optional `onInvalid`.
  - `resolve-policy.js`: in `--values` mode, for each requested key whose final entry carries `invalid: true`, write one line per key to stderr: `resolve-policy: warning: {key} has invalid value "{raw}" — using default "{value}"`. When no default exists, print `(none)`. Stdout and the exit code are untouched.
- [ ] **Step 3: Run** `node --test tests/resolve-policy-cli.test.js tests/resolve-policy-lib.test.js tests/release-reviewed-tip-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `refs #4141`.

---

## Self-review

- **Spec coverage:** Deliverable (stderr line per invalid key naming key, rejected value and default; stdout and exit unchanged) → Step 2. AC 1 (real CLI, run config with an invalid value, stdout default, exit 0, stderr names the key and `invalid`) → Step 1, first case. AC 2 (only valid keys → stderr empty) → Step 1, second case. AC 3 (`npm test` passes) → Common Step 5 verification.
- **Placeholders:** none.
