#!/usr/bin/env bash
# No network: forward the command in op run; with the token `stub-ok`, list and get one fake item.
subcommand=${1:-}
if [[ ${OP_SERVICE_ACCOUNT_TOKEN:-} == stub-ok && $subcommand == item ]]; then
  case ${2:-} in
    list) echo '[{"id":"item1"}]'; exit 0 ;;
    get) cat >/dev/null
         echo '{"id":"item1","title":"Example Item","fields":[{"label":"credential","value":"s3cret-value"},{"label":"note","value":""}]}'
         exit 0 ;;
  esac
fi
if [[ $subcommand == run ]]; then
  shift
  while (( $# )); do
    if [[ $1 == -- && $# -gt 1 ]]; then
      shift
      exec "$@"
    fi
    shift
  done
fi
echo "op-stub: $subcommand not supported" >&2
exit 1
