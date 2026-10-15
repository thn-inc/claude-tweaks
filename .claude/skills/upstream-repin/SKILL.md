---
name: upstream-repin
description: Use when moving one of this repo's upstream-dependency pins in tools/upstream-drift/manifest.yml to a newly installed version — the pin sites that must move together, the assertions and contract-paths to retarget when upstream retires a file, the fixtures to re-record, and the checks that prove the re-pin landed. The write-side companion to the read-only upstream-drift skill. Keywords - re-pin, pin, upgrade, manifest, pinned, pinned-engine, upstream-pin comment, contract fixtures, re-record, retirement sweep, Impeccable.
---

# Upstream re-pin

## Overview

`/upstream-drift` only reports: it never edits the manifest, and re-pinning is a deliberate act. This skill covers that act. A pin is not one value. The version of one upstream artifact is written in several places, and parity tests fail when they disagree. Some of those places are read by nothing at all, so a re-pin that misses one stays green.

Prior re-pins: `impeccable-cli` 3.6.0 to 4.1.0 (#2478, with #2321 for its contract test) and `impeccable-plugin` 4.0.2 to 4.5.0 with a new `impeccable-engine` 0.1.11 pin (#2985).

## Key Patterns

### Every site that holds the version

| Site | Read by |
|---|---|
| `tools/upstream-drift/manifest.yml` → the entry's `pinned` | `checkVersion` in `tools/upstream-drift/checks.js` |
| `tools/upstream-drift/manifest.yml` → `pinned-engine` (`impeccable-plugin` only) | Only the parity test. No check compares it with the installed engine |
| `<!-- upstream-pin: impeccable-cli@X -->` in `plugin/skills/design-wrapper/impeccable-cli.md` | The parity test in `tests/impeccable-cli-contract.test.js` |
| `<!-- upstream-pin: impeccable-plugin@X impeccable-engine@Y -->` in `plugin/skills/design-wrapper/impeccable-plugin.md` | The parity test in `tests/impeccable-plugin-contract.test.js` |

Read each value from the installed artifact, never from release notes. Plugin and engine: `node plugin/bin/impeccable-engine.js resolve` (`pluginVersion`, `engineVersion`). Record both pins from the **same** install.

### Retarget what upstream retired

When the new version deletes or renames a file, every manifest `contract-paths` entry and every `assertions[].upstream-path` pointing at it has to move. Point each claim at a surviving upstream file that still states it, or delete the assertion along with the local claim it backed. Do not loosen `must-match` until it matches anything. Test inputs that name the old path move too (#2985 changed one in `tools/upstream-drift/tests/run.test.js`).

When upstream retires a named surface this repo cited, add a permanent sweep so the name cannot drift back in (`tests/impeccable-retired-scripts-sweep.test.js`). Write it to the sweep guidance in the `skill-prose-conformance-tests` skill. Every exemption needs its own stale-check.

### Re-record fixtures from a real run

Fixtures under `tests/fixtures/impeccable-plugin/` are executed outputs, not hand-written ones. Each file's "Re-recording it" section in that directory's `README.md` gives the exact command and where to run it. `concept-seed` makes a network call, so it cannot be re-recorded from a sandbox. Replace only the envelope's `value` field, and apply the normalizations the README names.

### Keep the drift skill's worked examples true

`.claude/skills/upstream-drift/judge-procedure.md` step 3 has a table of verified contract-root mappings. #2478 updated the `impeccable-cli` row when its contract path moved. Recheck the mapping against the new tag with `gh api "repos/{repo}/git/trees/{tag}?recursive=1"`.

## Verify

```bash
node --test tests/impeccable-plugin-contract.test.js tests/impeccable-cli-contract.test.js tests/impeccable-retired-scripts-sweep.test.js tools/upstream-drift/tests/run.test.js
```

Then run `/upstream-drift --dep <name> --drift-only`. A contract-test skip reason that reads "installed version(s) do not match the pin" means the re-pin is not done.

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Moving `pinned` and leaving `pinned-engine` | No check reads `pinned-engine` against the install, so the stale engine pin stays green |
| Recording the plugin and engine pins from different installs | The manifest then describes an install that does not exist. Both come from one `resolve()` call |
| Hand-editing a fixture to the new shape | The contract test then proves the fixture matches the validator, not that the engine does |
| Treating a re-pin as part of an `/upstream-drift` audit | That skill is read-only by declared `allowed-tools`. Re-pinning is separate work, captured as its own record |
