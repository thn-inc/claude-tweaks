---
name: policy-key-addition
description: Use when adding a key to the policy.yml schema (`POLICY_KEYS` in `plugin/bin/lib/policy-schema.js`) or changing an existing key's shape — every registration site and pinning test, the who-may-set-it decision (`policyOnly` vs `policySourceExcluded`), the string, list and map validation flags, and the doc row that must state what the resolver actually returns. Keywords - policy key, POLICY_KEYS, policy-schema, resolve-policy, policyOnly, policySourceExcluded, allowWhitespace, closedQuote, pattern, element, map key, core tier cap, RENAMED_KEYS.
---

# Policy key addition

`plugin/bin/lib/policy-schema.js`'s `POLICY_KEYS` is the data, and `plugin/skills/_shared/policy-schema.md` is the prose index; "if the two disagree, one of them has a bug". `bin/resolve-policy.js` is the one read path skill prose uses. #4609's fourteen keys are the most recent large instance, and its review findings are the gotchas below.

## Sites

1. **The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived (`_shared/policy-schema.md`'s Derived-default keys, Shapes A and B). `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`). A boolean's value is the literal `true`/`false`, never `on`/`off`: `resolveValue` falls back to the default on any other spelling (the comment above `POLICY_KEYS`, #660).
2. **The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one.
3. **The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit.
4. **The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent. #4609's first `risk-path-globs` row said a malformed block resolves `{}`, the unset shape; the code gives `null` with `invalid: true` (review row 9).
5. **A renamed key** keeps its old name in `RENAMED_KEYS`, never in `POLICY_KEYS`. `tests/policy-schema.test.js` pins that count too.
6. **A Manifesto-visible lever** also walks `_shared/auto-mode-contract.md`'s "Adding a new policy lever" checklist.

## Decide who may set it

Two flags mirror each other. Pick by which source must never set the key:

- **`policyOnly: true`**: the resolver skips the `--run` overlay, so only `policy.yml` or the default applies. Use it for anything executed or anything that names who is trusted. #4609 set it on `deploy-command`, `owned-owners` and `trusted-authors` after review found a run config could otherwise set them (row 10). It set it on `risk-categories` too, because `risk-path-globs` validates against it from policy alone and the two must not disagree (row 11). The resolver reads only the checkout it runs in, so a key that a PR could rewrite in its own branch also needs its consumers to read it from the base branch. The resolver cannot do that for them; #4608 holds that requirement for the consumers (row 15).
- **`policySourceExcluded: true`**: a `policy.yml` value is discarded, so only a run-config source sets the key. Use it for a this-run-only decision that a standing default would quietly make permanent. `merge-authorization` is the one key with this flag today.

## Validation flags

- **`string`** is non-blank and whitespace-free by default. `allowWhitespace: true` opts a command-shaped value out of the whitespace rule (`release-hook`, `deploy-command`). Add `closedQuote: true` beside it: `parseFlatLines` cuts at any `#`, so a quoted value holding one is cut mid-quote, and `closedQuote` makes the leftover unclosed quote invalid rather than a truncated command. `release-hook` keeps its older contract without it.
- **`pattern`** is a whole-value regex. A URL key uses `HTTP_URL`, which refuses `@` in the authority because `policy.yml` is committed and must never carry a credential (row 14). Plain `http://` stays valid for dev URLs.
- **`list`** takes an optional `element` (`login` or `slug` in `LIST_ELEMENT_PATTERNS`) that every comma-separated entry must match, and an empty entry never does. The unset default is `[]`. A configured list resolves to the raw comma-separated string.
- **`map`** is a block key with no scalar form, so `--values` refuses it. `bin/resolve-policy.js` derives its block-key list from the `type: 'map'` rows. Never restate that list by hand (row 12). A malformed block resolves `null` with `invalid: true`, never a partial map.
- An invalid value resolves to the default with `invalid: true`. `parse-signal-discipline` item 14 covers when that fallback hides a typo from the consumer.

## Gotchas

- **A typo in a block key is invisible to `auditPolicy`**, because `parseFlatLines` drops a key with an empty value. This predates #4609 and also hits `model-profiles` (ledger row 8, deferred). Do not count on the audit to catch a misspelled block key.
- **Pin each new validation branch with its own assertion.** #4609's `closedQuote` branch had none at first: removing its `isValidValue` call left the suite green (row 6).
- **Changing what an existing value does needs two greps, not one.** Grep the key's kebab-case name across `plugin/skills/`, `docs/journeys/` and `README.md`, then grep its Manifesto display name too: `flow/manifesto-overrides.md`'s Override semantics table names levers that way (`` | Merge verification | `off` | ``), so the kebab-case grep never reaches it. #4550 changed what a derived `merge-verification: off` does; at its base `manifesto-overrides.md` had no `merge-verification` hit, and its stale `off` row and a journey's stale wording were caught only by the final whole-branch review.

## Evidence

- #4609: `0127c84e8` (control-mode keys), `8ddb2805c` (`risk-path-globs`), `1a8005e4c`, `c3cff4b18` and `cd548acff` (fix rounds), and rows 6-19 of the run's open-items ledger (deleted at close-out; last version in PR #4633).
- `merge-authorization` and `policySourceExcluded`: #715, generalized in #839.
