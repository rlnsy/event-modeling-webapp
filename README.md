Tracking https://github.com/dilgerma/event-modeling-spec/blob/main/eventmodeling.schema.json

Run `./ralph.sh` to continuously work on available Pad tasks. It checks again
every 60 seconds when idle or after a failed Codex run, and waits 2 seconds
between active iterations. Stop it with Ctrl-C.

Ralph starts a background app server at http://localhost:8777 before the first
iteration and passes its PID and log path to Codex, with instructions to restart
it if needed. Install dependencies first. The server stays running when Ralph
stops; use the reported PID to stop it manually.

Override timing with `POLL_SECONDS=120 SLEEP_SECONDS=5 ./ralph.sh`.
`MAX_ITERATIONS` defaults to `0` (unlimited); set a positive integer to cap the
number of Codex runs, including idle checks. Reaching that cap exits with status 1.
