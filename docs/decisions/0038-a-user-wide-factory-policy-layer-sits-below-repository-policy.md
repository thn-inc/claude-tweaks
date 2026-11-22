# 0038. A user-wide factory policy layer sits below the repository's policy, and four keys it may never set

- **Status:** accepted
- **Date:** 2026-11-22
- **Context:** #6006 (Phase 11 of `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`, `## Policy model`); follow-ups #6007 (direct readers) and #6008 (ceilings)

## Context

Until #6006, a policy key resolved from three places only: the run's `config.yml`, the
repository's `.claude-tweaks/policy.yml`, then the schema default. `policy.yml` has been the only
config home since 6.48.0, and nothing outside the repository could set a value.

The pipeline-economy design (Phase 0, 2026-11-18) requires that every lever can be set for a
factory and per repository, where a factory is one owner driving many repositories through
Dispatch. A factory that wants the same `model-stance`, `autonomy` or `model-profiles` everywhere
would otherwise have to commit the same lines to every repository's `policy.yml`. Dispatch
already merges stored variables into the environment of every run it starts, and a cloud sandbox
or Routine sees none of the machine's `~` files. So a per-user value has to be able to arrive
through the environment.

A layer outside the repository raises a question the repository-only model never had: which keys
must never come from a standing, user-wide source?

## Decision

The resolver gains a third standing source, `factory`. Precedence per key is run `config.yml`
(skipped for `policyOnly` keys), then `policy.yml`, then the factory layer, then the schema
default. A value from the layer resolves `{ value, source: 'factory' }`, and every consumer treats
it as explicit, the same as `policy`. It is never a default.

- **Inputs.** The `CLAUDE_TWEAKS_FACTORY_POLICY` variable holds policy text in `policy.yml`'s own
  format, multi-line block keys included. `~/.claude-tweaks/factory-policy.yml` is the fallback
  for interactive sessions. The two merge per key and the variable wins. Only
  `plugin/bin/lib/policy-factory.js` reads either one. `resolvePolicyKeys` stays pure and takes
  the merged text as `factoryRaw`, so aliases, validation and the invalid-no-cascade rule apply to
  it unchanged.
- **Block keys merge per row**, with the repository row winning over the factory row
  (`model-profiles` per profile, `express-driver-models` per role, `risk-path-globs` per category).
  A malformed factory block never drops the repository's rows.
- **Refused keys.** `FACTORY_REFUSED_KEYS = ['merge-authorization', 'control-mode',
  'deploy-command', 'release-hook']`. A refused key in the factory text resolves as if the layer
  did not set it, and the resolver writes one stderr warning. `merge-authorization` is a per-run
  human pre-authorization, so it must never be a standing default. `control-mode` is the single
  human-in-control switch, which #5830 ruled is set in `policy.yml` or not at all. `deploy-command`
  and `release-hook` are executed strings specific to one repository.
- **Every other key is settable**, `autonomy` and the trust lists (`owned-owners`,
  `trusted-authors`) included.
- `.claude-tweaks/policy.yml` stays the only *repository* config home. The factory layer belongs
  to the user and never becomes a second place for a repository's config.

## Alternatives considered

- **Put the factory above the repository, so a factory value overrides it.** Rejected: a
  repository could then no longer choose for itself. The design keeps repository over factory and
  makes the one exception explicit. For keys that bound spend, model tier, record size, risk or new
  records, the stricter of the two wins. That ceiling rule ships separately in #6008, so this layer
  could ship without changing any existing precedence test.
- **A user file only.** Rejected: it never reaches a cloud session or a scheduled Routine.
- **The variable only.** Rejected: an interactive session would need the value exported in every
  shell.
- **JSON in the variable.** Rejected: that needs a second parser and a second encoding for block
  keys. With `policy.yml`'s format, one parser serves every source.
- **A single-line encoding with literal `\n`.** Rejected at plan review. Dispatch stores and passes
  the value verbatim. The one gap is outside this repository: the hub editor's value field takes a
  single line, so a multi-line value is set through `POST /api/config-values`.
- **Refuse `autonomy` and the trust lists as well.** Rejected: letting a factory owner set them for
  every repository is the point of the layer. A repository tightens `autonomy` by setting it, and
  #6008's ceiling rule stops a repository from loosening a factory bound. The variable comes from
  the factory's own environment, never from a pull request's content.
- **Refuse three keys, leaving `release-hook` settable.** Rejected at plan review: `release-hook`
  is an executed, repository-specific string, the same as `deploy-command`.
- **Replace whole blocks instead of merging rows.** Rejected: a repository that overrides one
  `model-profiles` profile would silently lose every other profile the factory set.

## Consequences

- The layer is opt-in. With no variable and no file, every resolution is unchanged, and
  `resolve-policy.js --all` is byte-identical to the output before #6006.
- `source` now has the value `factory`, and that enum is a public contract. Any check of the form
  `source === 'default'` means "nobody set this" and must count a factory value as set. A change
  that treats `source === 'policy'` as proof that a value came from the repository (the planned
  #5963 symlink refusal and #4685 base-branch trust keys) must handle `factory` in the same change.
- Every new policy key needs a decision: settable from the factory layer, or refused. Every
  `policySourceExcluded` key must be in `FACTORY_REFUSED_KEYS`, which a `tests/policy-schema.test.js`
  invariant pins. `.claude/skills/policy-key-addition` carries this as registration site 10.
- Adding an existing key to the refused list later changes what live factory setups resolve to. The
  only signal is the stderr warning, so treat such a change as a contract narrowing and note it in
  the release.
- The variable is stored in Dispatch across many repositories. Renaming or removing it, the file
  path, or the `factory` source value needs expand-contract (CLAUDE.md).
- A developer's own factory file would reach the test suite. `CT_FACTORY_POLICY_FILE` (absolute
  paths only) relocates the file, and `tools/run-tests.js` and `tests/helpers/tmp-dir.js` point it
  at a path that does not exist. A bare `node --test` still sees a variable the developer exported,
  and that is accepted.
- The run manifest's `policyHash` covers factory values, so two runs under different factory
  settings hash differently.
- Revisit this decision if a factory needs to override a repository for a key that is not a
  ceiling, if a trust check must tell repository origin from factory origin, or if Dispatch can no
  longer carry a multi-line variable.
