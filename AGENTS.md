# AGENTS.md

Instructions for anyone, human or AI agent, changing this repository.

## What this is

op-agent gives Claude Code 1Password Service Account secrets: dev runs freely, prod asks the person first. No dependencies, no build step, Linux only.

| Path | Role |
|---|---|
| `bin/op-agent` | Bash wrapper. The only code that reads a token. Accepts `run`, `ssh`, `ssh-window`, `ls`. |
| `hooks/register.ts` | Claude Code hook: blocks tool calls that name the token or ticket, asks before `--prod` and leaves a one-use ticket. |
| `hooks/register.test.ts` | Hook tests (`claude plugin test .`). |
| `tests/wrapper.sh`, `tests/op-stub.sh` | Wrapper tests on a `sed` copy with a temp home and a fake `op`. |
| `scripts/op-host` | Optional helper for vault admin under NoNewPrivs. op-agent itself never uses it. |
| `.claude-plugin/` | Manifest (`version`) and marketplace entry. |

## Checks before every commit

```bash
bash tests/wrapper.sh      # every line `ok`, exit 0; no network, no real op
claude plugin validate .   # must pass
claude plugin test .       # hook tests
```

- CI runs neither `claude` command, so you must. Its two required jobs are `shell` (`bash -n`, `shellcheck --severity=warning`) and `wrapper`. Run shellcheck locally if you have it, and write empty assignments as `var=''` (SC1007).
- Never test with the real `op`, a real `op-agent --prod` or a real ssh host, and never touch the real token or ticket folders in your home. If a check could not run, say so; don't commit on "could not run".
- Tests can't cover the approval reaching the phone over Remote Control or a real ssh login. When a change touches those, say they are unverified so the owner tries them live.

## Rules that must not regress

**Model.** op-agent is a guardrail, not a sandbox: the tokens are files the agent's own user can read. The hard limit is each Service Account's vault scope. Never describe the approval, the path block or the masking as a boundary, in comments, docs or PR text.

**Wrapper** (`bin/op-agent`)

- Nothing that picks where the token, ticket or cache live may come from the environment or the arguments. Home comes from passwd (`getent`), never `$HOME`. No override variables: a test greps for the two old names; don't add new ones.
- Keep `#!/bin/bash -p`, the pinned `PATH`, the `unset` of every `OP_*` variable, and call every tool by absolute path. The caller's `PATH` goes only to the command `run` executes.
- Secrets enter a process, never stdout. No subcommand may print a value; `--no-masking` stays refused; the child of `run` never inherits the token. The token is a per-command prefix, never exported.
- `ls` uses the prod token with no ticket, so it prints names only. Values stay inside `jq`, which runs with `HOME=/nonexistent` (a caller's `~/.jq` can redefine the filter). Any tool that receives values gets the same care: no caller-controlled config or environment.
- ssh keys go `op read` → pipe → `ssh-add -t`, never through an environment (`unset` does not scrub it) or a file, and every loaded key has a lifetime. Host and item are regex-checked, options before the host are refused, and `--` precedes the host. The README's `Match exec` example names a fixed host; never use `%n` there.
- The prod ticket is claimed with an atomic `mv`, must be numeric, at most 120 s old, and is used once. Anything else exits 3. Every failure path fails closed.
- Exit codes `1`–`4` are documented in the README; treat them as API.

**Hook** (`hooks/register.ts`)

- Both hooks fail closed: their `.catch` denies unless `next` already ran.
- `hooks/hooks.json` (`{ "modules": [...] }`) is the engine's mods format, not a mistake. Don't convert it to the classic hooks format.
- The path block reads the whole tool call as text, after folding `//` and `/./`; `Write` and `Edit` are checked by `file_path` only, so docs may mention the paths.
- The hook never reads a token. It only writes the ticket, after "Approve", under the session's `$HOME`, and voids it in `finally`. If that home differs from passwd, prod fails closed (3).
- Every prod call asks, showing the full command and the `op://` references it can find (best effort, with a warning on `$(`, `cd` and similar). A dismissed dialog is a reject. Background prod runs and hand-built `ssh` inside a prod `run` are denied; `ssh-window --close` does not ask.
- Hook and wrapper can be installed at different versions. Each must stay safe alone: never move a check from one half to the other and delete it from the first.

A change near any of these needs a test that fails without it (break the code once and see it go red). Ask the owner for an independent adversarial review before merge.

## Tests

- `tests/wrapper.sh` swaps `getent` and `/usr/bin/op ` out with `sed`, then aborts if either survives. Call `op` exactly as `/usr/bin/op <args>` so the swap catches it; teach `tests/op-stub.sh` any new subcommand.
- Hook tests use `claude-code/testing`: mock engine events with `on(...)` and assert on what the person and the engine see (deny text, questions asked, commands run, ticket writes), not on internals.

## Public repo: nothing private

- No real account, vault item, host, client or organization names, no personal paths or emails, in code, tests, docs, commit messages or PR text. Use the placeholders already here: `example-host`, `Example API Key`, `<your-account>.1password.com`, the fake home `/home/t`.
- Never print `op` output that can carry values, not even through a `sed` or `cut` mask (a line-based mask leaked part of a multi-line key). Print only `jq`-selected names, or exit codes.
- Before pushing, run `git log origin/main..HEAD --format='%an <%ae>'`: every line must show a GitHub `noreply` email and the name you want public. Branch commits stay visible after a squash merge.
- No `Co-Authored-By` or attribution lines in commits or PR bodies (the body becomes the commit).
- Keep the "unofficial, not affiliated" notice (README disclaimer, start of the `plugin.json` description). No 1Password or Anthropic logos.

## Docs move with the code

- A behaviour change updates, in the same PR: `README.md` and `README.es.md` (kept line for line in step), the usage header of `bin/op-agent`, `SECURITY.md` when scope changes, and a line under `## Unreleased` at the top of `CHANGELOG.md` (add the heading if missing).
- State the exact condition, exceptions included. Reviews keep finding docs that overstate the code ("only reads names" when it fetches values and prints names).
- Everything is English except `README.es.md`.

## Git, PRs and releases

- `main` is protected with no bypass: PR required, `shell` and `wrapper` green, linear history, no force-push. Merges are squash-only, so the PR title and body become the commit. Subjects are imperative and say the effect (`README: document limits`, `Add op-agent ssh-window`).
- Installs update only when `version` in `.claude-plugin/plugin.json` changes. A release bumps it together with `CHANGELOG.md` (`## X.Y.Z - date`), the supported line in `SECURITY.md`, a hand-made tag `vX.Y.Z` and the GitHub Release. SemVer.
- Workflows: actions pinned to a full commit SHA with the version in a comment, `permissions: contents: read`, `persist-credentials: false`, a `timeout-minutes` per job.
- Ask the owner before anything outside a PR: repo settings, rulesets, visibility, tags, releases, force-pushes.

## Working here with op-agent installed

The installed hook denies any tool call whose input contains the token or ticket folder paths or the variable names in `TOKENS` (`hooks/register.ts`): a `grep` pattern, a heredoc, a commit message, a subagent brief, a PR body. Write such text with the file tools and pass it by file (`git commit -F`, `gh pr create --body-file`), or name the paths indirectly. A running session keeps the old hook until `/reload-plugins`.

## Don't

- Don't add dependencies, a build step, or a rewrite on the 1Password SDK: `op run` masking and the key pipe are the security properties.
- Don't add path or vault configuration, new platforms, a broker/sandbox redesign, or contributor paperwork (CONTRIBUTING, issue templates, DCO) unless the owner asks. These are decided, not forgotten.
- Don't weaken a guard to make a test or a workflow pass.
