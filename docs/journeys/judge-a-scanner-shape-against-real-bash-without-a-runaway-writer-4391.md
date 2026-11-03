---
files:
  - .claude/skills/shell-scanner-bash-differential/SKILL.md
---

# Judge a Scanner Shape Against Real Bash Without a Runaway Writer

**Persona:** A maintainer agent building or reviewing a change to `git-command.js`'s shell scanner. It is fuzzing hundreds of generated shapes through `/bin/bash` 3.2 and bash 5, unattended, often in a dispatched subagent that may be stopped mid-run.
**Goal:** Get each shape's real-bash verdict (what it wrote, and where) without any shape outliving its run, whatever the shape does and however the run ends.
**Entry point:** The `shell-scanner-bash-differential` skill's Common Operations: the "bash verdict" bullet and its Bounded bash verdict section, whose `runBash` driver is copied into a scratchpad node script.
**Success state:** Every shape returns within 5 s. No file it writes grows past 4 MiB, and no process from it survives the call, including `dd if=/dev/zero of=f1`, `cat a f1 > f1`, a backgrounded `dd … &`, a function that keeps calling itself in a pipeline (#4716), and a driver killed by SIGTERM. The session's own leftover check finds nothing.

## Steps

### 1. Run a corpus shape through the driver
- **URL:** `runBash(bash, cmd, { cwd, stubDir })` from the skill's Bounded bash verdict block, with `stubDir` holding the logging `git` stub and the real tools the case checks, linked one by one
- **Action:** The agent runs each generated shape under both bashes and reads the stub log and the files it wrote.
- **Should feel:** Like the old one-liner, with a hard ceiling. A write shape still writes, so the verdict is real, but it cannot run away: a file stops at 4 MiB, an endless loop stops at 5 s, and a word with no stub fails as `command not found` instead of running the real program.
- **Should understand:** The caps are `ulimit -f 4096` (1024-byte blocks) and `ulimit -u` at 256 above the uid's process count, both in the `bash -c` prefix and set soft and hard, so every child inherits them and none can raise them. A fork refused at the process cap marks the result `forkLimited`, which is not a verdict. Bash runs as its own process group (`detached: true`). The group is reaped on timeout, 300 ms after bash exits (so a backgrounded writer has opened its target), and on driver exit or SIGTERM/SIGINT/SIGHUP. Reaping is stop, then kill, repeated until the group is empty, because one SIGKILL can miss a child forked during it. Stdin is closed, and at most 64 KiB of each stream is kept. PATH is the stub dir alone, so a stub needs an absolute shebang and builtins only.
- **Red flags:**
  - A verdict call that takes longer than the timeout plus the grace window.
  - A case file larger than 4 MiB.
  - A real program running for a word the case never linked.

### 2. Stop the driver mid-run
- **URL:** The scratchpad driver process, stopped by its parent, by a dispatch cancel, or by SIGTERM
- **Action:** The run ends early with shapes still in flight.
- **Should feel:** Clean: nothing keeps writing after the driver is gone. A SIGKILLed driver, which cannot run its handlers, still leaves nothing that can fill the disk.
- **Should understand:** The driver tracks every live process group and reaps each one on `exit` and on the three handled signals, then sweeps for any bash carrying its run tag. SIGKILL skips all of that. The orphaned writer then dies by SIGXFSZ when its file hits the 4 MiB cap, and a forking shape stays under the process cap. Neither cap bounds CPU, so a case orphaned by SIGKILL runs on until the leftover check finds it.
- **Red flags:** A `dd`/`cat` with PPID 1, or a `bash -c ulimit -f …`, still running after the driver has exited.

### 3. Check for leftovers after the session
- **URL:** The skill's leftover check: `ps -ax -o pid=,ppid=,etime=,command= | awk '$2 == 1 && $4 ~ /(^|\/)g?(dd|cat)$/'`, then `lsof -p <pid>`, or `lsof +D <scratch dir>`; and for orphaned oracle shells, `pgrep -lf '[r]unBash-'` and `pgrep -lf 'ulimit -f [0-9]'`
- **Action:** Before ending the session, and after any killed run, the agent lists PPID-1 writers whose open output file sits under a `scratchpad/` or `agent-scratch/` path, and `kill -9`s them. It lists oracle shells whose driver is gone, stops and then kills them by their run's tag, and reports them to the user.
- **Should feel:** Like a one-command answer to "did I leave anything running?". `ps` shows the bare word (`dd if=/dev/zero …`), not the stub path, so the check matches the command word and confirms with `lsof`.
- **Should understand:** On 2026-10-26, three orphaned `dd` writers wrote ~463 GB into deleted files, invisible to any folder listing. The freed space can stay pinned by a Time Machine local snapshot (`tmutil listlocalsnapshots /`).
- **Red flags:** Free disk space dropping while no session is running a build.

## Origin
- Created during the build of #4391, after the 2026-10-26 disk-full incident: three orphaned `dd if=/dev/zero` writers from #4303's oracle tree (~463 GB over 7 h) and 30 orphaned `cat a f1` loops from #4281's fuzz scratch (17 h after archive). Both came from the skill's earlier unbounded `spawnSync` recipe. The driver was verified on bash 3.2.57 and 5.3 across the dd, cat, backgrounded-dd, endless-loop, unstubbed-word, spawn-failure, output-flood, SIGTERM and SIGKILL cases.
- Extended by #4716, after a self-calling fuzz shape kept forking through the driver's single group SIGKILL and left about 2,940 orphaned `bash` processes running for 3.5 days. That added the process cap, the stop-then-kill reap loop, the run-tag sweep and the oracle-shell leftover check.
- Related journeys: `write-a-quoted-windows-path-from-a-session-4281.md` and `write-a-glued-redirect-from-the-main-checkout-4015.md` (the scanner behavior these verdicts judge).
