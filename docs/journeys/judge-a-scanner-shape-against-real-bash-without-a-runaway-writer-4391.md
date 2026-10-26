---
files:
  - .claude/skills/shell-scanner-bash-differential/SKILL.md
---

# Judge a Scanner Shape Against Real Bash Without a Runaway Writer

**Persona:** A maintainer agent building or reviewing a change to `git-command.js`'s shell scanner. It is fuzzing hundreds of generated shapes through `/bin/bash` 3.2 and bash 5, unattended, often in a dispatched subagent that may be stopped mid-run.
**Goal:** Get each shape's real-bash verdict (what it wrote, and where) without any shape outliving its run, whatever the shape does and however the run ends.
**Entry point:** The `shell-scanner-bash-differential` skill's Common Operations: the "bash verdict" bullet and its Bounded bash verdict section, whose `runBash` driver is copied into a scratchpad node script.
**Success state:** Every shape returns within 5 s. No file it writes grows past 4 MiB, and no process from it survives the call, including `dd if=/dev/zero of=f1`, `cat a f1 > f1`, a backgrounded `dd … &`, and a driver killed by SIGTERM. The session's own leftover check finds nothing.

## Steps

### 1. Run a corpus shape through the driver
- **URL:** `runBash(bash, cmd, { cwd, stubDir })` from the skill's Bounded bash verdict block, with `stubDir` holding the logging `git` stub and the real tools the case checks, linked one by one
- **Action:** The agent runs each generated shape under both bashes and reads the stub log and the files it wrote.
- **Should feel:** Like the old one-liner, with a hard ceiling. A write shape still writes, so the verdict is real, but it cannot run away: a file stops at 4 MiB, an endless loop stops at 5 s, and a word with no stub fails as `command not found` instead of running the real program.
- **Should understand:** The cap is `ulimit -f 4096` (1024-byte blocks) in the `bash -c` prefix, set soft and hard, so every child inherits it and none can raise it. Bash runs as its own process group (`detached: true`). The group is killed on timeout, 300 ms after bash exits (so a backgrounded writer has opened its target), and on driver SIGTERM/SIGINT/SIGHUP. Stdin is closed, and at most 64 KiB of each stream is kept. PATH is the stub dir alone, so a stub needs an absolute shebang and builtins only.
- **Red flags:**
  - A verdict call that takes longer than the timeout plus the grace window.
  - A case file larger than 4 MiB.
  - A real program running for a word the case never linked.

### 2. Stop the driver mid-run
- **URL:** The scratchpad driver process, stopped by its parent, by a dispatch cancel, or by SIGTERM
- **Action:** The run ends early with shapes still in flight.
- **Should feel:** Clean: nothing keeps writing after the driver is gone. A SIGKILLed driver, which cannot run its handlers, still leaves nothing that can fill the disk.
- **Should understand:** The driver tracks every live process group and kills each one on `exit` and on the three handled signals. SIGKILL skips that. The orphaned writer then dies by SIGXFSZ when its file hits the 4 MiB cap. The cap bounds disk, not CPU, so a non-file writer orphaned by SIGKILL runs on until the leftover check finds it.
- **Red flags:** A `dd`/`cat` with PPID 1 still running after the driver has exited.

### 3. Check for leftovers after the session
- **URL:** The skill's leftover check: `ps -ax -o pid=,ppid=,etime=,command= | awk '$2 == 1 && $4 ~ /(^|\/)g?(dd|cat)$/'`, then `lsof -p <pid>`, or `lsof +D <scratch dir>`
- **Action:** Before ending the session, and after any killed run, the agent lists PPID-1 writers whose open output file sits under a `scratchpad/` or `agent-scratch/` path, and `kill -9`s them.
- **Should feel:** Like a one-command answer to "did I leave anything running?". `ps` shows the bare word (`dd if=/dev/zero …`), not the stub path, so the check matches the command word and confirms with `lsof`.
- **Should understand:** On 2026-10-26, three orphaned `dd` writers wrote ~463 GB into deleted files, invisible to any folder listing. The freed space can stay pinned by a Time Machine local snapshot (`tmutil listlocalsnapshots /`).
- **Red flags:** Free disk space dropping while no session is running a build.

## Origin
- Created during the build of #4391, after the 2026-10-26 disk-full incident: three orphaned `dd if=/dev/zero` writers from #4303's oracle tree (~463 GB over 7 h) and 30 orphaned `cat a f1` loops from #4281's fuzz scratch (17 h after archive). Both came from the skill's earlier unbounded `spawnSync` recipe. The driver was verified on bash 3.2.57 and 5.3 across the dd, cat, backgrounded-dd, endless-loop, unstubbed-word, spawn-failure, output-flood, SIGTERM and SIGKILL cases.
- Related journeys: `write-a-quoted-windows-path-from-a-session-4281.md` and `write-a-glued-redirect-from-the-main-checkout-4015.md` (the scanner behavior these verdicts judge).
