# Acceptance

Release is accepted only if all gates pass:

1. No stub markers in code.
2. `tools/list` exposes the full POC tool surface.
3. Live `hol.stats` call succeeds.
4. Live discovery tools return valid response schemas.
5. Registration flow quote -> register -> wait is functional (or deterministic timeout).
6. Chat flow create -> send -> history -> end works with valid credentials.
7. Smoke tests pass for both HTTP and stdio transports.
