#!/usr/bin/env bash
set -euo pipefail

# Zero means keep running until interrupted.
MAX_ITERATIONS="${MAX_ITERATIONS:-0}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
POLL_SECONDS="${POLL_SECONDS:-60}"

for setting in MAX_ITERATIONS SLEEP_SECONDS POLL_SECONDS; do
  if [[ ! "${!setting}" =~ ^(0|[1-9][0-9]*)$ ]]; then
    echo "$setting must be a non-negative integer." >&2
    exit 1
  fi
done

command -v codex >/dev/null || { echo "codex is required." >&2; exit 1; }

PROMPT="$(cat <<'EOF'
Use the pad skill.

Find the next available task and work on it.

Requirements:
- Inspect the current repository state first.
- Use the skill to discover task state.
- Select the highest-priority actionable task.
- Continue existing work when appropriate.
- Work on a 'ralph' branch in your own worktree (also called 'ralph')
- Make the required code changes.
- Run relevant tests, checks, builds, or linters.
- Update task state using the skill.
- Do not merge your branch to main.
- Keep the app served at port 8777, in the background so it doesn't stop when this session stops. Restart it if needed.
- If the current task is blocked, record that through the skill and exit this iteration.
- If there are no actionable tasks remaining, output exactly:

RALPH_DONE
EOF
)"

iteration_limit="$MAX_ITERATIONS"
if ((MAX_ITERATIONS == 0)); then
  iteration_limit="unlimited"
fi

for ((i = 1; MAX_ITERATIONS == 0 || i <= MAX_ITERATIONS; i++)); do
  echo
  echo "=== Ralph iteration $i (limit: $iteration_limit) ==="
  echo

  LAST_MESSAGE="$(mktemp)"
  trap 'rm -f "$LAST_MESSAGE"' EXIT

  delay="$SLEEP_SECONDS"
  if codex exec \
    --approve-for-me \
    --ephemeral \
    --output-last-message "$LAST_MESSAGE" \
    "$PROMPT"; then
    cat "$LAST_MESSAGE"
    if grep -Fxq 'RALPH_DONE' "$LAST_MESSAGE"; then
      echo
      echo "No actionable tasks remain. Checking again in $POLL_SECONDS seconds."
      delay="$POLL_SECONDS"
    fi
  else
    status=$?
    # Preserve interruption rather than retrying a cancelled session.
    if ((status == 130 || status == 143)); then
      exit "$status"
    fi
    echo "Codex exited with status $status. Retrying in $POLL_SECONDS seconds." >&2
    delay="$POLL_SECONDS"
  fi

  rm -f "$LAST_MESSAGE"
  trap - EXIT

  if ((MAX_ITERATIONS == 0 || i < MAX_ITERATIONS)); then
    sleep "$delay"
  fi
done

echo
echo "Stopped after MAX_ITERATIONS=$MAX_ITERATIONS."
exit 1
