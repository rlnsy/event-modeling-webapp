Tracking https://github.com/dilgerma/event-modeling-spec/blob/main/eventmodeling.schema.json

Run `./ralph.sh` to continuously work on available Pad tasks. It checks again
every 60 seconds when idle or after a failed Codex run, and waits 2 seconds
between active iterations. Stop it with Ctrl-C.

Override timing with `POLL_SECONDS=120 SLEEP_SECONDS=5 ./ralph.sh`.
`MAX_ITERATIONS` defaults to `0` (unlimited); set a positive integer to cap the
number of Codex runs, including idle checks. Reaching that cap exits with status 1.
