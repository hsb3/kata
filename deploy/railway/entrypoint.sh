#!/bin/sh
# Reproduces the runtime contract of the live Railway kata-daemon service
# (docs/fork/migration/RECON.md): translate PUBLIC_ORIGIN into
# [web].public_origin, then run the daemon in hosted ($PORT) mode.
#
# Everything else comes straight from the environment and needs no help here:
# KATA_DSN, KATA_HOME, KATA_AUTH_TOKEN, KATA_TRUST_PRIVATE_NETWORK,
# KATA_POSTGRES_ALLOW_INSECURE, KATA_GITHUB_TOKEN, PORT.
set -eu

KATA_HOME="${KATA_HOME:-/data}"
export KATA_HOME
mkdir -p "$KATA_HOME"
config="$KATA_HOME/config.toml"

# kata never reads PUBLIC_ORIGIN itself (it is a security input validated
# against Host/Origin), so the platform value has to be written into config.
if [ -n "${PUBLIC_ORIGIN:-}" ]; then
  if grep -qE '^[[:space:]]*\[web\]' "$config" 2>/dev/null; then
    echo "kata-entrypoint: $config already defines [web]; PUBLIC_ORIGIN not applied" >&2
  else
    printf '[web]\npublic_origin = "%s"\n' "$PUBLIC_ORIGIN" >> "$config"
  fi
fi

exec kata daemon start --foreground "$@"
