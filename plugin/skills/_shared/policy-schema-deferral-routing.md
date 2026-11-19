<!-- Sibling of `_shared/policy-schema.md` — its "## Deferral routing" lever-table detail, split out so the index file keeps headroom under its size ceiling. -->

## Deferral routing

Registered by #5932. `bin/deferral-route.js` reads the key through `bin/resolve-policy.js`'s resolver, from `policy.yml`, overlaid by a run's `config.yml` when the call passes `--run {dir}`. It is not `policyOnly` and not a Manifesto lever. `_shared/materiality-floor.md`'s Overrides section gives its place in the precedence.

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `deferral-digest-reasons` | `policy.yml` (or a run's `config.yml` via `--run`) | `bin/deferral-route.js` | `[]` | `Defer-reason:` values (`_shared/deferral-gate.md`'s vocabulary) that send an agent-raised deferral to the digest whatever its size, priority and risk; human input and a `high`/`critical` severity still file. Unset resolves `[]`. `pre-existing-outside-diff, tangential` resolves to that raw comma-separated string. `[]` is the explicit empty list: it resolves `[]` from its own source, so a run's `config.yml` holding `[]` overrides a repository list. A blank value reads as unset and falls through. An element outside the vocabulary (`not-a-reason`, `Tangential`, a trailing comma's empty entry) makes the whole value invalid: it resolves to `[]` with `invalid: true`, and `bin/deferral-route.js` prints one stderr warning naming the key and the bad element, then routes as if unset. The run-config overlay is a resolver capability: `set-config.js` writes no such key (it accepts only the Manifesto levers and run pins), and no routing site passes `--run`, so in a pipeline run the repository value applies. |
