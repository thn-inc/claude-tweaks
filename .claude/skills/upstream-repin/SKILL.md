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
| `SUPERPOWERS_FLOOR` in `plugin/bin/lib/superpowers-version.js` (`superpowers` only) | The parity test in `tests/bin-lib/superpowers-version.test.js`, and the SessionStart notice threshold (#3380) |

Read each value from the installed artifact, never from release notes. Plugin and engine: `node plugin/bin/impeccable-engine.js resolve` (`pluginVersion`, `engineVersion`). Record both pins from the **same** install.

### Retarget what upstream retired

When the new version deletes or renames a file, every manifest `contract-paths` entry and every `assertions[].upstream-path` pointing at it has to move. Point each claim at a surviving upstream file that still states it, or delete the assertion along with the local claim it backed. Do not loosen `must-match` until it matches anything. Test inputs that name the old path move too (#2985 changed one in `tools/upstream-drift/tests/run.test.js`).

When upstream retires a named surface this repo cited, add a permanent sweep so the name cannot drift back in (`tests/impeccable-retired-scripts-sweep.test.js`). Write it to the sweep guidance in the `skill-prose-conformance-tests` skill. Every exemption needs its own stale-check.

### Re-record fixtures from a real run

Fixtures under `tests/fixtures/impeccable-plugin/` are executed outputs, not hand-written ones. Each file's "Re-recording it" section in that directory's `README.md` gives the exact command and where to run it. `concept-seed` makes a network call, so it cannot be re-recorded from a sandbox. Replace only the envelope's `value` field, and apply the normalizations the README names.

### Keep the drift skill's worked examples true

`.claude/skills/upstream-drift/judge-procedure.md` step 3 has a table of verified contract-root mappings. #2478 updated the `impeccable-cli` row when its contract path moved. Recheck the mapping against the new tag with `gh api "repos/{repo}/git/trees/{tag}?recursive=1"`.

### An entry with no contract tests: re-verify every literal, then pin new ones

The `superpowers` entry has two version sites: its `pinned` value and `SUPERPOWERS_FLOOR` in `plugin/bin/lib/superpowers-version.js` (#3380). The parity test in `tests/bin-lib/superpowers-version.test.js` fails until both move, and moving the floor deliberately raises the SessionStart notice threshold for every project still on the previous version. The entry has no `upstream-pin` comment, no contract test over upstream content and `fixtures: []`, so the drift checks are its only proof of upstream behaviour. `checkAssertions` reads only the cached copy whose version equals `pinned` (`resolveRoots`), and it matches each `must-match` with `content.includes` on raw bytes. For an entry like that:

- Move the pin before adding assertions. A line that exists only in the new release cannot match while the old pin stands.
- Count every existing `must-match` with `grep -cF` against the new copy of its `upstream-path`. A file that survives can still drop the literal. 7.0.0's brainstorming rewrite dropped `Invoke the writing-plans skill`, and #3376 retargeted the assertion to the surviving `invoke superpowers:writing-plans and no other skill`, with the reason in a manifest comment.
- Use single-line fragments. A literal that wraps across two upstream lines never matches.
- A new assertion's `claims:` names the record that will rely on the line and the release the line first appeared in, measured against the local caches. Write "6.2.0 or earlier" when the oldest cached copy already has it.
- Prove a new assertion can fail without editing the manifest. Change its `must-match` in memory, then check that only that assertion comes back `unmatched`:

```bash
node -e "const{loadManifest}=require('./tools/upstream-drift/manifest.js');const{checkAssertions}=require('./tools/upstream-drift/checks.js');const d=structuredClone(loadManifest('./tools/upstream-drift/manifest.yml').dependencies.find(x=>x.name==='superpowers'));d.assertions.at(-1)['must-match']='zzz-not-upstream';console.log(checkAssertions(d).results.filter(x=>x.status!=='ok'))"
```

The re-pin is done when the drift run reports assertions `ok` with every assertion checked. `skipped` means no cached copy matched `pinned`, so nothing was checked.

### The `claude-code` entry: a floor pin whose assertions live in code

`claude-code` is drift-only: `version-mode: floor`, `report-upgrades: false`, `contract-paths: []`, `fixtures: []`, and its `root` command resolves the installed binary file itself, so every `upstream-path` is `"."` and `checkAssertions` reads the binary as raw bytes (#3304). A re-pin moves `pinned` and nothing else, because Claude Code ships near daily and no other site holds its version. The assertions are the part that must not move on their own:

- The first five `must-match` values mirror `REFUSAL_FRAGMENTS` in `plugin/bin/lib/hooks/harness-refusal.js`. Change a fragment there and in the manifest in the same commit; `tests/harness-refusal-drift-pin.test.js` fails until they agree.
- The last four are anchors unique to the matched refusal templates. The two with a dash (the git-operations anchor and the fixed worktree-gone anchor) spell it as the six-character backslash-u2014 escape, because that is how the minified source holds it. The Edit and Write tools normalize a typed backslash-u2014 into a raw em dash, so after editing one of those two values, confirm the manifest line still holds the six characters. Before re-pinning, run `checkAssertions` on the claude-code entry against the new install and count each literal. A bundler change that emits a raw em dash makes the anchor go `unmatched` for a reason that is not a rewording.
- There is no capability half to diff, so skip the `contract-paths` reading below for this entry.

### Read what changed, not just whether it still matches

A `must-match` proves that a line survived. It does not show that the behaviour around that line stayed the same. For each of the entry's `contract-paths`, diff the old and new cached copies, for example `diff -u ~/.claude/plugins/cache/claude-plugins-official/superpowers/{old}/skills/subagent-driven-development/SKILL.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/{new}/skills/subagent-driven-development/SKILL.md`. Read the hunks that touch what this repo's files rely on, and list each behaviour change next to the local file it affects. In 6.2.0 → 7.0.0 every pinned literal still matched, yet SDD stopped asking the human about load-bearing findings and started writing `Ruling:` ledger lines instead. `plugin/skills/build/dispatch.md`'s carry-forward did not copy those lines (#3386). A gap found this way gets its own record. Do not fix it inside the re-pin.

## Verify

```bash
node --test tests/impeccable-plugin-contract.test.js tests/impeccable-cli-contract.test.js tests/impeccable-retired-scripts-sweep.test.js tests/bin-lib/superpowers-version.test.js tools/upstream-drift/tests/run.test.js
```

Then run `/upstream-drift --dep <name> --drift-only`. A contract-test skip reason that reads "installed version(s) do not match the pin" means the re-pin is not done. Neither check reads behaviour, so the re-pin is also not done until every `contract-paths` diff has been read and each behaviour change is fixed or filed.

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Moving `pinned` and leaving `pinned-engine` | No check reads `pinned-engine` against the install, so the stale engine pin stays green |
| Recording the plugin and engine pins from different installs | The manifest then describes an install that does not exist. Both come from one `resolve()` call |
| Hand-editing a fixture to the new shape | The contract test then proves the fixture matches the validator, not that the engine does |
| Treating a re-pin as part of an `/upstream-drift` audit | That skill is read-only by declared `allowed-tools`. Re-pinning is separate work, captured as its own record |
| Concluding "nothing breaks" because every assertion is `ok` | Literals survive while the behaviour around them moves. The 7.0.0 `Ruling:` change was found only by reading the `contract-paths` diff |
