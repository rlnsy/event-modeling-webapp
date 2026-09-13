#!/usr/bin/env bash
set -euo pipefail

MAX_ITERATIONS="${MAX_ITERATIONS:-100}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

PROMPT='
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
- If the current task is blocked, record that through the skill and exit this iteration.
- If there are no actionable tasks remaining, output exactly:

RALPH_DONE
'

for ((i = 1; i <= MAX_ITERATIONS; i++)); do
  echo
  echo "=== Ralph iteration $i / $MAX_ITERATIONS ==="
  echo

  LAST_MESSAGE="$(mktemp)"
  trap 'rm -f "$LAST_MESSAGE"' EXIT

  codex exec \
    --approve-for-me \
    --ephemeral \
    --output-last-message "$LAST_MESSAGE" \
    "$PROMPT"

  cat "$LAST_MESSAGE"

  if grep -Fxq 'RALPH_DONE' "$LAST_MESSAGE"; then
    echo
    echo "No actionable tasks remain."
    exit 0
  fi

  rm -f "$LAST_MESSAGE"
  trap - EXIT

  sleep "$SLEEP_SECONDS"
done

echo
echo "Stopped after MAX_ITERATIONS=$MAX_ITERATIONS."
exit 1
