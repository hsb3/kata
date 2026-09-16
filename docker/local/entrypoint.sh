#!/bin/sh
set -eu

if [ ! -e /data/kata.db ]; then
	export KATA_SERVER=http://kata:8080
	export KATA_ALLOW_INSECURE=1
	/entrypoint.sh &
	daemon_pid=$!
	trap 'kill "$daemon_pid" 2>/dev/null || true' EXIT
	for _ in $(seq 1 30); do
		if kata projects create demo-workspace >/dev/null 2>&1; then break; fi
		sleep 1
	done
	kata --project demo-workspace create "Review the workspace palette" --priority 1 --owner example-agent --label frontend --force-new >/dev/null
	kata --project demo-workspace create "Resolve the release checklist" --priority 2 --owner example-reviewer --label release --force-new >/dev/null
	kata --project demo-workspace create "Investigate an intermittent sync delay" --priority 0 --owner example-agent --label bug --force-new >/dev/null
	kill "$daemon_pid"
	wait "$daemon_pid" 2>/dev/null || true
	trap - EXIT
fi

exec /entrypoint.sh "$@"
