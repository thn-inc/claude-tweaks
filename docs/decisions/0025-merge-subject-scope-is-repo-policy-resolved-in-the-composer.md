# 0025. A merge subject's scope comes from repo policy, resolved inside the composer

- **Status:** accepted
- **Date:** 2026-10-17
- **Context:** #3298

## Context

Every merge fence runs `plugin/bin/compose-subject.js` to get a Conventional-Commits merge
subject. #3028 gave it a `--scope <token>` flag, but nothing said where the value came from: there
was no policy key, no record field and no derivation rule. Only `_shared/pr-first-merge.md` Step 3
mentioned the flag. The four local-merge fences (`_shared/local-merge-auto-finish.md`,
`wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`)
did not, so the same project got scoped subjects on one integration path and unscoped ones on
the other.

The other half of the subject comes from the record. The composer reads the Type (`feat`/`fix`/
`chore`) from each record's native issue type or `type:*` label. So a reader would expect the
scope to be a record field too.

Three constraints shaped the answer:

- `policy.yml` is read by a flat `key: value` parser (`parseFlatLines`). A nested map is not
  possible, but a comma-separated list value already is (`readListKey`, as in
  `merge-sensitive-paths`).
- Six composer call lines exist across five fence files. A shell conditional at each one would
  put the precedence rule in six places.
- The fences do not run in the same place. Under local-merge the composer runs from the main
  checkout, with both branch refs present. Under pr-first, `dispatch/close-out.md` and `/tidy`'s
  Arm-ready-PR step run `pr-first-merge.md` Step 3 from a later session, which has no local
  branch for the run and a stale local integration ref.

## Decision

The scope is a property of the repo's layout, not of the work. So it comes from project policy,
and the composer resolves it. It is never a per-record field.

There are two `advanced`-tier keys:

- `commit-scope` holds one constant token.
- `commit-scope-paths` holds comma-separated `{path-prefix}={token}` pairs, matched against the
  merge's changed files.

The pure resolver `plugin/bin/lib/commit-scope.js` applies this precedence:

1. An explicit `--scope` on the composer call wins. This is the auto-mode contract's
   CLI-over-policy rule.
2. Otherwise each changed file takes its longest matching prefix. If exactly one distinct token
   results, that token is the scope.
3. Otherwise `commit-scope` applies.
4. Otherwise the subject is unscoped.

Two cases are refused instead of composing a quietly wrong subject:

- `commit-scope-paths` is set but the call names no diff source: exit 1.
- A `commit-scope` token that `composeSubject` rejects: exit 1. The policy reader hands
  `composeSubject` the raw trimmed value, not a schema-nulled one.

The changed-file set comes from the integration model. Local-merge fences pass
`--range {base}...{head}`, which reads `git diff --name-only -z --end-of-options` and uses three
dots so integration-branch drift is excluded. Pr-first fences pass `--pr {n}`, which reads
`gh pr diff --name-only` from the PR itself and needs no local checkout.

## Alternatives considered

- **A per-record scope field, set at `/claude-tweaks:specify` time.** This would add a
  specify-time step to every record for a value that depends on which files change. An agent
  setting it would have to guess from the planned paths anyway, before the diff exists. It would
  also be a work-record schema addition, which is a heavier contract than a policy key.
- **One polymorphic `commit-scope` key holding either a token or a path map.** Every policy value
  is a single flat string, so the key would need an in-band grammar to tell the two forms apart.
  Two keys give a clean ladder, and a monorepo can set both: the constant covers a merge whose
  paths match nothing or span packages.
- **Resolving the scope in each fence's shell and passing `--scope`.** This puts the precedence
  rule in six copies, and the copies drift. Resolving inside the composer means every fence
  composes the same subject. The fences differ only in the diff source they name.
- **Erroring when the changed paths span several scopes.** Conventional Commits allows an
  unscoped subject, and a merge that touches several packages has no single scope. So the
  resolver falls through to the constant or to unscoped, and a stderr note names the scopes it
  spanned.
- **One diff source for both integration models.** A local `--range` everywhere gives the wrong
  answer in a pr-first session that does not hold the run's branch. `gh pr diff` everywhere would
  put a network read and a PR number on local-merge projects, which may have no forge at all.

## Consequences

- A project with no scope convention sets neither key and nothing changes. Both flags and both
  keys are additive.
- Changing the source later means a deprecation cycle, not an edit. For example, moving to a
  per-record field or renaming either key would need expand-contract across users'
  `policy.yml` files.
- Every fence must name a diff source. `tests/merge-subject-composer-conformance.test.js`'s
  `COMPOSER_CALL` regex pins this at all six call lines, so a fence added later without one fails
  the suite.
- Pr-first resolution costs a network read. A PR over GitHub's diff-size limit exits 3 when
  `commit-scope-paths` is set, because there is no files-API fallback. The exit names the PR and
  never falls back to an unscoped subject.
- A `=` inside a prefix or token is unsupported, because entries split on the first `=`.
- Revisit this if a project needs a scope that does not follow its file layout, such as a
  feature-area scope that cuts across directories. That need would point back to a per-record
  field.
