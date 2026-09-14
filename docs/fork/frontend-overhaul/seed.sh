#!/usr/bin/env bash
# Seed an ISOLATED local fork daemon with realistic neutral data. Never run against a hosted daemon.
set -euo pipefail
R=${R:?set R to a scratch dir containing home/ (KATA_HOME with config.toml) and ws/}
K=${K:-$(git rev-parse --show-toplevel)/kata}
k() { (cd "$R/ws" && env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR -u KATA_DB KATA_HOME="$R/home" "$K" "$@"); }
# c PROJECT ACTOR TITLE [create flags...] -> prints short_id
c() { local p=$1 a=$2 t=$3; shift 3; k create "$t" --project "$p" --as "$a" --force-new --json "$@" | jq -r .issue.short_id; }

CL=claude@spoke-mac CX=codex HB=henry

k projects create spoke-project >/dev/null
EPIC=$(c spoke-project $HB "Workstream: ship spoke v2 sync engine" --priority 1 --label workstream \
  --body $'## Goal\n\nReplace the polling sync with an event-driven engine.\n\n- [ ] design doc\n- [ ] migration\n- [ ] rollout')

for p in hub-service ops-runbooks docs-site inbox; do k projects create $p >/dev/null; done
# Scale: ~40 projects on one daemon, like real usage.
for n in $(seq -w 1 34); do k projects create "side-project-$n" >/dev/null; done

S=spoke-project
d1=$(c $S $CL "Design doc: event-driven sync" --parent $EPIC --priority 1 --label design --owner $CL --body $'Draft the design.\n\nSee `internal/sync` for current poller.')
d2=$(c $S $CX "Add sync_cursor migration" --parent $EPIC --priority 1 --label db --label migration --blocked-by $d1)
d3=$(c $S $CL "Roll out sync engine behind flag" --parent $EPIC --priority 2 --label rollout --blocked-by $d2)
d4=$(c $S $HB "Benchmark sync throughput at 10k issues" --parent $EPIC --priority 2 --label perf --related $d1)
d5=$(c $S $CX "Flaky test: TestSyncReconnect times out on CI" --priority 0 --label bug --label ci --owner $CX)
d6=$(c $S $CL "Retry budget exhausted silently on 503" --priority 1 --label bug --related $d5 --owner $CL)
d7=$(c $S $HB "Decide: keep SQLite WAL or move to Postgres" --priority 1 --label decision)
d8=$(c $S $CL "Document sync failure modes" --priority 3 --label docs --related $d6)
d9=$(c $S $CX "Remove legacy poller after rollout" --priority 3 --label cleanup --blocked-by $d3)
d10=$(c $S $HB "Spike: CRDT merge for offline edits" --priority 4 --label spike)
d11=$(c $S $CL "Expose sync lag metric" --priority 2 --label observability --parent $EPIC)
d12=$(c $S $CX "Fix typo in CLI help for sync" --priority 4 --label docs)

H=hub-service
h1=$(c $H $HB "Workstream: hub auth hardening" --priority 1 --label workstream)
h2=$(c $H $CL "Rotate daemon tokens without downtime" --parent $h1 --priority 1 --label security --owner $CL)
h3=$(c $H $CX "Rate-limit token exchange endpoint" --parent $h1 --priority 1 --label security --blocked-by $h2 --owner $CX)
h4=$(c $H $CL "Audit log for token admin actions" --parent $h1 --priority 2 --label security --related $h2)
h5=$(c $H $HB "Hub returns 500 when project name has a slash" --priority 0 --label bug)
h6=$(c $H $CX "Upgrade Go toolchain to 1.27" --priority 3 --label deps)
h7=$(c $H $CL "Cross-project: spoke needs hub cursor API" --priority 1 --label api --related "$S#$d2")
h8=$(c $H $CX "Add healthcheck for replica lag" --priority 2 --label observability)
h9=$(c $H $CL "Cache project list response" --priority 3 --label perf)

O=ops-runbooks
o1=$(c $O $HB "Runbook: restore from nightly backup" --priority 1 --label runbook)
o2=$(c $O $CL "Verify backup restore on staging" --priority 1 --label runbook --blocked-by $o1 --owner $CL)
o3=$(c $O $CX "Alert when disk usage > 80%" --priority 2 --label alerting)
o4=$(c $O $CL "Rotate TLS certs before expiry" --priority 0 --label security)
o5=$(c $O $HB "Weekly: review stale claims" --priority 3 --label routine)

D=docs-site
w1=$(c $D $CL "Rewrite quickstart for agents" --priority 2 --label docs --owner $CL)
w2=$(c $D $CX "Broken links in reference/cli.md" --priority 2 --label bug)
w3=$(c $D $HB "Screenshots for web UI guide are stale" --priority 3 --label docs)
w4=$(c $D $CL "Add search to docs site" --priority 4 --label feature)

I=inbox
i1=$(c $I $HB "Look into weird spoke sync lag report")
i2=$(c $I $HB "Idea: attention digest email")
c side-project-01 $CX "Bootstrap repo" --priority 2 >/dev/null
c side-project-02 $CL "Evaluate charting library" --priority 3 >/dev/null
c side-project-07 $HB "Renew domain" --priority 1 >/dev/null

# Agent attention states (work.attention / work.attention_msg)
m() { k meta set "$1" "$2" "$3" --project "$4" --as "$5" >/dev/null; }
m $d1 work.attention ok $S $CL;          m $d1 work.attention_msg "drafting section 3, ETA today" $S $CL
m $d5 work.attention needs-human $S $CX; m $d5 work.attention_msg "cannot repro locally; need CI runner access" $S $CX
m $d6 work.attention stuck $S $CL;       m $d6 work.attention_msg "blocked on upstream 503 semantics decision" $S $CL
m $h2 work.attention ok $H $CL
m $h3 work.attention needs-human $H $CX; m $h3 work.attention_msg "pick limit: 10/min or 60/min?" $H $CX
m $o2 work.attention needs-human $O $CL; m $o2 work.attention_msg "staging creds expired" $O $CL
m $w1 work.attention ok $D $CL

# Comments
k comment $d1 --project $S --as $CL -m $'Pushed first draft to branch `sync-design`.\n\nOpen question: cursor per project or per replica?' >/dev/null
k comment $d1 --project $S --as $HB -m "Per project. Replica cursors are an implementation detail." >/dev/null
k comment $d5 --project $S --as $CX -m $'Failed 3/20 runs. Log excerpt:\n\n```\ncontext deadline exceeded after 30s\n```' >/dev/null
k comment $h3 --project $H --as $CX -m "Implemented token bucket; limit value pending decision." >/dev/null
for i in 1 2 3 4 5 6; do k comment $d7 --project $S --as $([ $((i%2)) = 0 ] && echo $HB || echo $CL) -m "Discussion round $i: tradeoffs of WAL vs Postgres for multi-daemon." >/dev/null; done

# Schedules and deadlines
k schedule $d7 "$(date +%Y-%m-%d)" --project $S --as $HB >/dev/null
k deadline $o4 "$(date -v+3d +%Y-%m-%d)" --project $O --as $HB >/dev/null
k deadline $d5 "$(date -v-1d +%Y-%m-%d)" --project $S --as $HB >/dev/null
k schedule $w3 "$(date -v+5d +%Y-%m-%d)" --project $D --as $HB >/dev/null

# Closes with evidence
k close $d12 --project $S --as $CX --reason done --commit 3f2a9c1 --test "go test ./internal/cli" --message "Fixed typo in sync help text; verified help output snapshot test passes." >/dev/null
k close $h6 --project $H --as $CX --reason done --pr https://github.com/example/hub/pull/42 --test "make test" --message "Bumped go.mod toolchain to 1.27; full suite green on CI." >/dev/null
k close $w2 --project $D --as $CL --reason done --commit 9bd01e7 --reviewed docs/reference/cli.md --message "Repaired 4 relative links; link checker reports zero broken links." >/dev/null
k close $d10 --project $S --as $HB --reason wontfix --message "Out of scope for v2; revisit after offline mode is prioritized." >/dev/null
k close $i2 --project $I --as $HB --duplicate-of "$I#$i1" --message "Same underlying request as the lag report triage item." >/dev/null
k close $o5 --project $O --as $CL --reason audit-no-change --evidence "no-change-audit:no stale claims older than 7 days" --message "Reviewed all claims across projects; none stale this week." >/dev/null

echo "seeded: epic=$EPIC d1=$d1 d5=$d5 h1=$h1 h3=$h3 o2=$o2 i1=$i1"
