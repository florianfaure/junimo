<!-- >>> roadmapped >>> -->
## Roadmapped

This repo uses **Roadmapped** (flat-file project management, agent-driven).

- **At session start**: if the Roadmapped dashboard is not already open, run
  `npx roadmapped dashboard` (idempotent — no-op if it's already running, otherwise opens the browser).
- Every task creation/update goes through the roadmapped skill or `npx roadmapped <cmd>`
  (never edit the YAML files under `docs/tasks/` by hand).
<!-- <<< roadmapped <<< -->
