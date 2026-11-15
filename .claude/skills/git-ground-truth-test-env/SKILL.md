---
name: git-ground-truth-test-env
description: Use when writing or reviewing a test that asks real git for an expected value, or that tests code taking an `env` parameter which defaults to `process.env`, or writing code that re-implements or caches an answer git gives (a reader of `.git`/`commondir`/config files, a memo or store over `git rev-parse` validated by a filesystem signature). Covers why such a test inherits the host's and the test runner's git config, the explicit reader env, the hermetic env for a git child that supplies ground truth, proving both under `tools/run-tests.js`, and deriving a reader's or cache's inputs from what git itself reads. Keywords - ground truth, GIT_CONFIG_COUNT, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_GLOBAL, safe.directory, READER_ENV, process.env default, vacuous pass, fallback test, commondir, gitfile, signature, repoInfo, ownership.
---

# Git ground truth test env

A test that compares code against real git, or that leaves an `env` parameter at its `process.env` default, takes its git configuration from wherever it runs. Two places differ from a bare local `node --test`:

- `tools/run-tests.js` exports `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` to every test (`gitFixtureConfigEnv`, #5297). A reader that hands the question back to git whenever `GIT_CONFIG*` is set then defers in every test, so each "defers to git" test passes whatever the reader does.
- GitHub's Ubuntu runner image carries `safe.directory = *` in its system git config. A git child that should refuse a repo for ownership opens it there, so a "git refuses this repo" expectation is false.

Both hit #5266's status line tests. Under the runner, 10 of 210 tests failed and every origin "defers to git" test passed without proving anything (fixed in `4b3c66a3b`). On the branch's first Ubuntu CI run, two ownership tests failed in shard 2 of 4 (run 43404443208).

## Rules

1. **A reader call in a test passes an explicit env.** Build it from `process.env` minus the variables the reader keys on. `READER_ENV` in `tests/statusline.test.js` drops every `GIT_CONFIG*` name; a test of the deferral then passes exactly the variable it is about (`assertFallbackOrigin(dir, { GIT_CONFIG_GLOBAL: '/dev/null' })`).
2. **A git child that supplies ground truth about refusal or trust runs hermetic.** Set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device, as `DIFFERENT_OWNER_ENV` in `tests/statusline.test.js` does, so a host `safe.directory` entry cannot change the answer.
3. **Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input. Reproduce the CI case locally with a `GIT_CONFIG_SYSTEM` file that trusts every directory.
4. **Prove a fallback test with a mutation.** Remove the check its trigger depends on and see the test go red under the runner. A fallback test that stays green without its check was passing on the env.

## Code that re-implements or caches git's answer starts from what git reads

A reader that answers a git question from files, or a cache that reuses git's answer while a filesystem signature holds, is correct only if it covers every input git consults for that answer. Write that list from git's own discovery steps first, before the spec's list of inputs, and check each item off in the code or name it as an accepted divergence in the docs:

- the directory's real path (git walks the real path, so a symlink into a subdirectory is followed), and the nearest `.git` on it;
- the `.git` entry's kind: a directory, or a `gitdir:` file and the admin dir it names;
- `commondir`, read for a `.git` directory too (git treats any git dir that has one as a linked worktree);
- the layout git validates: `HEAD`, `objects`, `refs` present and of the right kind;
- ownership (`ensure_valid_ownership` checks the worktree, `.git` and gitdir against the process uid, then `safe.directory`);
- the enclosing repo's index (the superproject check makes `isLinkedWorktree` false for a gitlink there);
- every config file git reads: common config, `config.worktree`, global, and system;
- the environment variables that change discovery (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`) and those that change config (`GIT_CONFIG*`, `HOME`, `XDG_CONFIG_HOME`).

Any file whose content you read must be a regular file, checked on the open descriptor: a named pipe at `commondir` blocks the process for ever.

A second implementation on the same branch is the checklist. Diff the new list against it. #5294's `repoInfo` signature (`plugin/bin/lib/hooks/repo-info-cache.js`) was written from its spec's inputs. It reached the list above only through four review fix waves (`733c576fa`, `a3dcd82bd`, `23a20aab3`, `222881f65`), each with its own verify and Windows run. Meanwhile #5266's `commonDirFromFs` in `plugin/bin/claude-tweaks-statusline.js` already modelled the gitfile, `commondir`, the layout and ownership. The pipe hang, the ignored enclosing index, and stale answers after `HEAD` loss were all gaps in the list, not code bugs. The worked list is `docs/hooks.md`'s "repoInfo cache (#5294)" section, including its accepted divergences.

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Calling a reader with its `process.env` default in a fallback test | Under `tools/run-tests.js` the runner's `GIT_CONFIG_*` triggers the fallback, so the test passes whatever the reader does |
| Asking git for a refusal with the host's config | A system or global `safe.directory` entry makes git accept the repo, and the expectation is false on that host only |
| Proving a git-facing test with a bare `node --test` alone | The bare run has neither the runner's env nor the CI image's config |
| Writing a cache signature from the spec's input list | Each input git reads that the list misses is a stale answer found later, one review wave at a time |

## Reference

- Tests: `tests/statusline.test.js` (`READER_ENV`, `DIFFERENT_OWNER_ENV`), `tests/helpers/repo-info-cache.js` (a fresh store and a discovery env cleared of git variables for cache tests)
- Runner: `tools/run-tests.js` (`gitFixtureConfigEnv`, the per-run `CT_HOOKS_REPO_INFO_STORE`)
- Code: `plugin/bin/claude-tweaks-statusline.js` (`commonDirFromFs`, `originUrlFromConfig`), `plugin/bin/lib/hooks/repo-info-cache.js`
- Related skills: `suite-slot-test-env` (the same inherited-env trap for the suite slot), `windows-checkout-test-parity`
