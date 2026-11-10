#!/usr/bin/env bash
# The apps' tests, several apps at a time.
#
#   scripts/run_tests_parallel.sh [jobs]
#
# One `scripts/run_tests.sh <app>` per app that has tests, `jobs` of them at
# once (default: a quarter of the cores, at least 2), each with its own log;
# then every app's summary line, the failures, and the totals. The
# environment (TEST_AOT, BRONZE_GC_STRESS, BRO_HEADLESS, ...) is run_tests.sh's
# and is passed through. The serial script is the reference: a perf test
# (test_perf*) asserts frame times and may fail here under load where it
# passes alone, so a failure is worth rerunning with `run_tests.sh <app>`.
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
cores=$(nproc 2>/dev/null || echo 8)
jobs=${1:-$(( cores / 4 ))}
[ "$jobs" -lt 2 ] && jobs=2

logs=$(mktemp -d "${TMPDIR:-/tmp}/helmapps-par.XXXXXX")
trap 'rm -rf "$logs"' EXIT

apps=()
for appdir in "$here"/*/; do
    app=$(basename "$appdir")
    ls "$appdir"tests/test_*.js >/dev/null 2>&1 && apps+=("$app")
done

printf '%s\n' "${apps[@]}" | xargs -P "$jobs" -I{} sh -c '"$0/scripts/run_tests.sh" "$1" > "$2/$1.log" 2>&1' "$here" {} "$logs"

pass=0; fail=0; skip=0
for app in "${apps[@]}"; do
    line=$(grep -E '^ +[0-9]+ tests: ' "$logs/$app.log" | tail -1)
    if [ -z "$line" ]; then
        echo "  $app: no summary (the run died); its log follows"
        tail -20 "$logs/$app.log"
        fail=$((fail + 1))
        continue
    fi
    echo "  $app:$line"
    p=$(echo "$line" | sed -E 's/.*: ([0-9]+) passed.*/\1/')
    f=$(echo "$line" | sed -E 's/.* ([0-9]+) failed.*/\1/')
    s=$(echo "$line" | sed -E 's/.* ([0-9]+) skipped.*/\1/')
    pass=$((pass + p)); fail=$((fail + f)); skip=$((skip + s))
    if [ "$f" != "0" ]; then grep -A12 -E '^ +FAIL ' "$logs/$app.log" | head -60; fi
done
echo "────────────────────────────────────"
echo "  $((pass + fail + skip)) tests: $pass passed, $fail failed, $skip skipped"
[ "$fail" = "0" ]
