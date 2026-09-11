#!/usr/bin/env bash
set -euo pipefail

MAX_ITERATIONS="${MAX_ITERATIONS:-100}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

if ! command -v codex >/dev/null 2>&1; then
  echo "error: codex CLI not found"
  exit 1
fi

for ((i = 1; i <= MAX_ITERATIONS; i++)); do
  echo
  echo "=== Ralph iteration $i / $MAX_ITERATIONS ==="
  echo

  OUTPUT="$(
    codex exec --full-auto '
Use the pad skill.

Find the next available task and work on it.

Requirements:
- Inspect the current repository state first.
- Use the skill to discover task state; do not maintain a separate local task list.
- Select the highest-priority actionable task.
- Continue existing work if the task is already partially implemented.
- Make the required code changes.
- Run relevant tests, checks, builds, or linters.
- Update task state using the skill as appropriate.
- Do not stop merely because one subtask is complete.
- If there are no actionable tasks remaining, output exactly:

RALPH_DONE
'
  )"

  printf '%s\n' "$OUTPUT"

  if grep -qx 'RALPH_DONE' <<<"$OUTPUT"; then
    echo
    echo "No actionable tasks remain."
    exit 0
  fi

  sleep "$SLEEP_SECONDS"
done

echo
echo "Stopped after MAX_ITERATIONS=$MAX_ITERATIONS."
exit 1
