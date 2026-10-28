---
files:
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/bin/lib/hooks/post-tool-use.js
  - plugin/skills/_shared/policy-schema-coverage.md
  - docs/hooks.md
---

# Get a Disguised Main-Checkout Write Denied From a Worktree

**Persona:** An agent session working in a linked worktree of a `worktree-always` project. It writes compound shell (`cd ../main || cd T; …`, `cp -rt DIR …`, `perl -0pi …`, `echo x >& f`, long chains of `{ cd …; }` groups). Nobody reviews each Bash call.

**Goal:** Every Bash call that bash would run as a write or commit in the main checkout is denied, however the `cd` before it is dressed up. A worktree-local write still runs.

**Entry point:** A Bash tool call from the worktree. `git-command.js`'s cd walk (`forEachShellSegment`) resolves each write, mkdir and git target to the cwd bash would be in. `pre-tool-use.js`'s worktree gate, pipeline shadow guard and teardown gate then decide.

**Success state:**
- `cd ../main || cd T; echo x > f` is refused with `claude-tweaks: this project requires an isolated worktree`, and so are the other disguised shapes in step 1.
- `cd sub && echo x > f` inside the worktree runs.
- A 16-plus-cd command whose walk loses track of the cwd is denied in this opted-in session, and is checked as base checked it in a project without the policy.

## Steps

### 1. Write after a disguised cd: worktree, policy on
- **URL:** These Bash calls, each run from the worktree:
  - `cd ../main || cd T; echo x > f`
  - `cd ../main | true; …`
  - `x=$(cd Q) cd ../main; echo hi | tee f`
  - `cp -rt ../main src`
  - `perl -0pi -e 's/a/b/' ../main/f`
  - `echo x >& ../main/f`
  - `x=$(true; cd ../main && y=$(( (1 & 3) )) && git commit -am x)`
  - `cd ../main && case a in a) cd ../wt;; esac | cat; echo x > f`
  - `cd ../main; case a in a) cd ../wt;; esac > f`
  - `cd ../main; a=() case x | cd ../wt; echo hi > f.js`
- **Action:** The session runs each.
- **Should feel:** Refused, with the same denial and "use a worktree" remediation a plain `echo x > ../main/f` gets. No shape slips through because of how the cd or flag was written.
- **Should understand:** The walk follows bash's semantics, each checked against bash 3.2 and 5:
  - A cd behind `&&`/`||` may or may not run, so the walk keeps every cwd bash could be in and fails closed.
  - A cd in a pipeline element runs in a subshell and does not carry over.
  - An assignment-prefixed cd still runs.
  - `-t` inside a flag cluster, and a glued `-tDIR`, name the target dir.
  - A digit in a perl cluster (`-0pi`) does not hide `-i`.
  - `>& word` and `>&word` write to the file `word`.
  - An `&` inside arithmetic parentheses is not a background.
  - A `case … esac` that is the first element of a pipeline runs in a subshell, so its arm's cd does not reach the next command. The walk checks the write under both the pipeline's start and the arm's cwd, and keeps a separate record per nested case.
  - A redirect on a `case … esac` opens before any arm runs, so it resolves under the case's start (and, failing closed, the arm's cwd too).
  - `x=()` is an empty array assignment, not a function definition, so the word after it is a command.
- **Red flags:**
  - One of these runs while its plain form is denied.
  - A denial names a fragment such as `&` or `1` as the path. `(( a>1 || b>2 ))` resolves no target.

### 2. Run a long cd chain: worktree, policy on
- **URL:** A Bash call with 16 or more distinct `{ cd …; }` groups (`CWD_SET_CAP`), then a relative write, mkdir or commit
- **Action:** The session runs it.
- **Should feel:** Refused without a long hang, by a denial of its own rather than the usual one: `claude-tweaks: this command changes directory more ways than the hook's shell scanner follows, so it cannot tell where …`. It says to use absolute paths (`git -C <absolute path>` for git) or to split the command. A 44 KB command decides in well under a second.
- **Should understand:**
  - Past the cap the walk has lost the cwd bash is in, so every target from there carries `lost: true`. In a session whose own repo has worktree-always on, the gate denies a lost target outright. An indeterminate repo status still allows, with a warning.
  - The shadow guard also denies a lost mkdir on a `.claude-tweaks/pipelines` trail, including one entered before the loss.
  - The teardown gate denies a relative `git worktree remove` from a lost cwd.
- **Red flags:**
  - A long command takes many seconds in the hook.
  - A lost write inside this worktree's main checkout runs.

### 3. Run the same chain where the policy is off: another project
- **URL:** The same long-chain command, run in a project whose `worktree-always` is off or absent
- **Action:** The session runs it.
- **Should feel:** Uneventful. Nothing is denied that this plugin's base release allowed, and no message cites a policy that does not exist.
- **Should understand:**
  - The command is walked a second time the way base d9aa6b82d walked it, and the targets that walk finds are checked as ordinary ones.
  - **The accepted gap (user decision, 2026-10-26):** a session that is not opted in and climbs into a policy repo through 16 or more cds stays allowed wherever base allowed it.
  - A lost `git commit` that runs here is found afterwards by `post-tool-use.js`, which looks in the main checkout, each of its worktrees and base's readings' checkouts for a fresh commit whose subject is the command's own `-m` text. It judges that commit's closing keyword and logs its breadcrumb only when exactly one checkout offers one; with none or two, it warns about none.
- **Red flags:** A refusal here that cites `worktree-always`.

### 4. Know the documented gaps: same session
- **URL:** The "Where a relative target resolves" paragraph in `plugin/skills/_shared/policy-schema-coverage.md`, and `docs/hooks.md`'s lost-cwd bullet
- **Action:** Read them before relying on the gate for an unusual shape.
- **Should feel:** Clear about where the line is.
- **Should understand:** These shapes are tracked follow-ups, not supported bypasses:

  | Shape | Record |
  |---|---|
  | The command inside `$( … )` or backticks | #4446 |
  | A NAME=value, `env` or `sudo` prefix | #4448 |
  | `cd -`, `$OLDPWD`, a symlinked dir or a failing cd | #4450 |
  | Compound-command bodies (including a case or `cd` inside an `if`/`while`/`for` body), `pushd` and `builtin cd` | #4244 |
  | zsh-only forms (redirects, a pipeline's last element) | #4455 |
  | A `case` whose cd arm does not match | #4486 |
  | A function called after a later cd | #4487 |
- **Red flags:** A skill or procedure that tells agents to use one of these shapes because the gate misses it.

## Origin
- Created during the build of #4303. That build fixed the seven fail-opens #4149's review left (U1–U6, S49, S50), then made the cwd cap affordable. Losing track of the cwd past the cap led to the `lost` marker and its consumers, which were settled on base parity by the user's decision.
- Updated during the build of #4481: a `case` compound that starts a pipeline, a redirect on a case compound, nested cases, and `x=()` no longer leak a main-checkout write.
- Related journeys:
  - `write-a-glued-redirect-from-the-main-checkout-4015.md`, the redirect scan the same walk feeds.
  - `run-a-heredoc-node-script-from-the-main-checkout-3989.md`, the heredoc carve-out.
