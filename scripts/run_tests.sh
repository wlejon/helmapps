#!/usr/bin/env bash
# Run the helm apps' headless tests against a stock bro-headless.
#
#   scripts/run_tests.sh [app] [test-name-filter]
#
# Every <app>/tests/test_*.js runs as
#   bro-headless --width 1280 --height 800 <app> <test>
# with its own BRO_APP_HOME, so no test reads or writes the user's settings
# and no test sees what an earlier one left behind. Exit status 77 is a skip.
#
# Environment:
#   BRO_HEADLESS       the bro-headless binary (default: ../bro's build tree)
#   BRO_TERM_TESTCHILD term's test child; by default bro's bro_pty_child
#                      (beside bro-headless) copied under the name
#                      term-testchild, which selects its reporting mode
#   TEST_TIMEOUT       seconds per test (default 180)
#   VERBOSE            set: print a passing test's console.log lines too
#                      (the timings a perf test reports)
set -u

here=$(cd "$(dirname "$0")/.." && pwd)
only_app=${1:-}
filter=${2:-}
timeout_s=${TEST_TIMEOUT:-180}

exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

headless=${BRO_HEADLESS:-}
if [ -z "$headless" ]; then
    for c in "$here/../bro/build/Release/bro-headless$exe" "$here/../bro/build-release/bro-headless$exe" \
             "$here/../bro/build/bro-headless$exe" "$(command -v bro-headless 2>/dev/null)"; do
        if [ -n "$c" ] && [ -x "$c" ]; then headless=$c; break; fi
    done
fi
if [ -z "$headless" ] || [ ! -x "$headless" ]; then
    echo "run_tests: no bro-headless (set BRO_HEADLESS)" >&2
    exit 2
fi
echo "bro-headless: $headless"

work=$(mktemp -d "${TMPDIR:-/tmp}/helmapps-tests.XXXXXX")
trap 'rm -rf "$work"' EXIT

# term's test child: bro_pty_child under a name containing "testchild".
if [ -z "${BRO_TERM_TESTCHILD:-}" ]; then
    src="$(dirname "$headless")/bro_pty_child$exe"
    if [ -x "$src" ]; then
        mkdir -p "$work/bin"
        cp "$src" "$work/bin/term-testchild$exe"
        export BRO_TERM_TESTCHILD="$work/bin/term-testchild$exe"
    else
        echo "run_tests: no bro_pty_child beside bro-headless; tests that need the child skip" >&2
    fi
fi

pass=0; fail=0; skip=0
failed=()
bronze_bin=${BRONZE_BIN:-}
if [ -z "$bronze_bin" ]; then
    for b in "$here/../bronze/build/src/cli/bronze$exe" "$(dirname "$headless")/_deps/bronze-build/src/cli/bronze$exe"; do
        if [ -n "$b" ] && [ -x "$b" ]; then bronze_bin=$b; break; fi
    done
fi
for appdir in "$here"/*/; do
    app=$(basename "$appdir")
    [ -f "$appdir/bro.json" ] || continue
    [ -n "$only_app" ] && [ "$app" != "$only_app" ] && continue
    if [ -n "$bronze_bin" ] && [ -z "$filter" ] && [ -f "$appdir/js/main.js" ]; then
        if "$bronze_bin" check "$appdir/js/main.js" > "$work/$app-check.log" 2>&1; then
            pass=$((pass + 1)); printf '  PASS  %s/bronze-check (0s)\n' "$app"
        else
            fail=$((fail + 1)); failed+=("$app/bronze-check")
            printf '  FAIL  %s/bronze-check\n' "$app"
            cat "$work/$app-check.log" | sed 's/^/        /'
        fi
    fi
    for t in "$appdir"tests/test_*.js; do
        [ -f "$t" ] || continue
        name=$(basename "$t" .js)
        [ -n "$filter" ] && [[ "$name" != *"$filter"* ]] && continue
        home="$work/home/$app-$name"
        mkdir -p "$home"
        log="$work/$app-$name.log"
        start=$(date +%s)
        # The app's own folder is trusted, so a test may use the privileged
        # namespaces its bro.json asks for ("permissions": remote's remote).
        trusted=$(cd "$appdir" && (pwd -W 2>/dev/null || pwd))
        XDG_DATA_HOME="$home/data" BRO_TRUSTED_APP_DIR="$trusted" BRO_APP_HOME="$home" timeout "$timeout_s" "$headless" --width 1280 --height 800 "${appdir%/}" "$t" > "$log" 2>&1
        rc=$?
        secs=$(( $(date +%s) - start ))
        if [ $rc -eq 0 ]; then
            pass=$((pass + 1)); printf '  PASS  %s/%s (%ss)\n' "$app" "$name" "$secs"
            # The test's own console.log lines (timings, counts) on request.
            [ -n "${VERBOSE:-}" ] && grep -a '^\[INFO\]  ' "$log" | sed 's/^\[INFO\]  /        /'
        elif [ $rc -eq 77 ]; then
            skip=$((skip + 1)); printf '  SKIP  %s/%s: %s\n' "$app" "$name" "$(grep -i skip "$log" | tail -1)"
        else
            fail=$((fail + 1)); failed+=("$app/$name")
            printf '  FAIL  %s/%s (rc=%s, %ss)\n' "$app" "$name" "$rc" "$secs"
            tail -25 "$log" | sed 's/^/        /'
        fi
    done
done

echo "────────────────────────────────────"
echo "  $((pass + fail + skip)) tests: $pass passed, $fail failed, $skip skipped"
for f in "${failed[@]+"${failed[@]}"}"; do echo "    - $f"; done
[ $fail -eq 0 ]
