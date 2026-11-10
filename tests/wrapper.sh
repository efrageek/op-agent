#!/usr/bin/env bash
# Self-check for a temporary copy of bin/op-agent with fake tokens and a local op stub (no network).
set -u
root="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
HOME=$(mktemp -d) || exit 1
export HOME
trap 'rm -rf "$HOME"' EXIT
B="$HOME/op-agent"
sed -e 's|^home=$(/usr/bin/getent .*|home="'"$HOME"'"|' \
    -e 's|/usr/bin/op |"'"$root"'/tests/op-stub.sh" |g' "$root/bin/op-agent" > "$B" || exit 1
if grep -qE 'getent|/usr/bin/op([^a-z-]|$)' "$B"; then
  echo "wrapper test: unsafe copy still contains getent or /usr/bin/op " >&2
  exit 1
fi
! grep -qE 'OP_AGENT_(HOME|DIR)' "$root/bin/op-agent" || { echo "wrapper test: home/token overrides remain" >&2; exit 1; }
chmod +x "$B" || exit 1
ticket="$HOME/.cache/op-agent/prod.ticket" fail=0
check() { [[ $2 == "$3" ]] && echo "ok   $1" || { echo "FAIL $1: got '$2' want '$3'"; fail=1; }; }

out=$("$B" ls 2>&1); rc=$?
check "ls needs token files" "$rc" 2
check "ls explains missing tokens" "$out" 'op-agent: no token files in ~/.config/op-agent (see README)'
mkdir -p "$HOME/.config/op-agent" "$HOME/.cache/op-agent"
echo bogus | tee "$HOME/.config/op-agent/dev.token" > "$HOME/.config/op-agent/prod.token"

"$B" read op://claude-dev/example-key/credential 2>/dev/null; check "only run" $? 2
"$B" run true 2>/dev/null; check "run needs --" $? 2
"$B" run --no-masking=true -- true 2>/dev/null; check "no masking off" $? 2
check "token not inherited" "$(OP_RUN_NO_MASKING=1 "$B" run -- sh -c 'echo ${OP_SERVICE_ACCOUNT_TOKEN:-unset}/${OP_RUN_NO_MASKING:-unset}')" unset/unset
check "OP_CONNECT_HOST not inherited" "$(OP_CONNECT_HOST=x "$B" run -- sh -c 'echo ${OP_CONNECT_HOST:-unset}')" unset
"$B" --prod run -- true 2>/dev/null; check "prod needs ticket" $? 3
date +%s > "$ticket"; "$B" --prod run -- true; check "prod with ticket" $? 0
check "ticket is one-use" "$([[ -e $ticket ]] && echo left || echo gone)" gone
date +%s > "$ticket"; touch -d '-5 min' "$ticket"; "$B" --prod run -- true 2>/dev/null; check "stale ticket" $? 3
"$B" --prod ssh example-host true 2>/dev/null; check "prod ssh needs ticket" $? 3
"$B" ssh 2>/dev/null; check "ssh needs a host" $? 2
"$B" ssh --key example-key 2>/dev/null; check "ssh --key needs a host" $? 2
"$B" ssh -A example-host true 2>/dev/null; check "ssh rejects -A host" $? 2
"$B" ssh -oProxyCommand=x example-host 2>/dev/null; check "ssh rejects ProxyCommand host" $? 2
"$B" ssh --key -example-key example-host 2>/dev/null; check "ssh rejects key starting with -" $? 2
"$B" ssh --key example/key example-host 2>/dev/null; check "ssh rejects slash in key" $? 2
"$B" --prod ssh --key 'example-key (test)' example-host 2>/dev/null; check "ssh accepts quoted key title" $? 3
item=x window=1 "$B" run -- true 2>/dev/null; check "run ignores inherited internals" $? 0
"$B" --prod ssh-window example-host 2>/dev/null; check "ssh-window needs ticket" $? 3
"$B" --prod ssh-window example-host 121 2>/dev/null; check "ssh-window max 120 min" $? 2
"$B" --prod ssh-window example-host 0 2>/dev/null; check "ssh-window rejects zero minutes" $? 2
"$B" --prod ssh-window example-host abc 2>/dev/null; check "ssh-window rejects non-numeric minutes" $? 2
"$B" --prod ssh-window example-host 18446744073709551676 2>/dev/null; check "ssh-window rejects overflowing minutes" $? 2
"$B" --prod ssh-window example-host 08 2>/dev/null; check "ssh-window accepts decimal minutes" $? 3
"$B" --prod ssh-window 'example/host' 2>/dev/null; check "ssh-window rejects odd host" $? 2
"$B" ssh-window --close >/dev/null; check "ssh-window --close needs no ticket" $? 0
"$B" --prod ssh-window --close >/dev/null; check "prod ssh-window --close needs no ticket" $? 0
echo void > "$ticket"; "$B" --prod run -- true 2>/dev/null; check "voided ticket" $? 3
echo 12x > "$ticket"; "$B" --prod run -- true 2>/dev/null; check "non-numeric ticket" $? 3

# PATH and BASH_ENV must not reach the ticket check: fake mv (binary or function) would "claim" a ticket.
mkdir "$HOME/bin"; printf '#!/bin/sh\ndate +%%s > "$2"\n' > "$HOME/bin/mv"; chmod +x "$HOME/bin/mv"
PATH="$HOME/bin:$PATH" "$B" --prod run -- true 2>/dev/null; check "fake mv in PATH" $? 3
echo 'mv() { date +%s > "$2"; }' > "$HOME/benv"
BASH_ENV="$HOME/benv" "$B" --prod run -- true 2>/dev/null; check "BASH_ENV mv function" $? 3
timeout 30 "$B" ssh example-host true 2>/dev/null; rc=$?
check "dev ssh fails cleanly" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo ok)" ok
out=$(timeout 30 "$B" ls 2>&1 >/dev/null); rc=$?
check "ls does not hang" "$([[ $rc -ne 124 ]] && echo ok)" ok
check "ls reports dev failure" "$([[ $out == *"op-agent: dev listing failed"* ]] && echo ok)" ok
check "ls reports prod failure" "$([[ $out == *"op-agent: prod listing failed"* ]] && echo ok)" ok
echo stub-ok | tee "$HOME/.config/op-agent/dev.token" > "$HOME/.config/op-agent/prod.token"
want=$(printf 'op://claude-%s/Example Item/credential\top-agent %srun\tExample Item\n' dev '' prod '--prod ')
check "ls lists names only" "$("$B" ls 2>&1)" "$want"
echo 'def select(f): .label = .value;' > "$HOME/.jq"   # a caller's ~/.jq must not reach the wrapper's jq
check "ls ignores a hostile ~/.jq" "$("$B" ls 2>&1)" "$want"
exit $fail
