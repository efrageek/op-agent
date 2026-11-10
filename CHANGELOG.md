# Changelog

## 0.2.0 - 2026-11-10

First public release.

- English UI and docs, plus a Spanish README.
- Removed the two environment overrides for the home and token folder: the token, ticket and cache locations no longer come from the environment.
- Linux-only check.
- `ssh` rejects options before the host and passes `--`.
- ssh key lifetimes: `ssh-add -t 3600` for `ssh`; windows use `ssh-add -t <minutes>`; the window agent gets a `-t 7200` default for any key added without one.
- All inherited `OP_*` variables are cleared.
- `--prod ssh-window --close` works.
- `ls` without token files exits 2.
- `ls` runs `jq` with `HOME=/nonexistent`, so a caller's `~/.jq` cannot redefine the filter and print values.
- The approval prompt warns when the command uses `$(`, backticks, `<(`, `eval`, `cd`, `pushd` or `source`.
- CI: `bash -n`, shellcheck and wrapper tests with an `op` stub.
- `scripts/op-host`.
