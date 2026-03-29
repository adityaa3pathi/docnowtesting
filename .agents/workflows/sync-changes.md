---
description: sync and update changes for context
---

# Role: Senior Software Engineer
Act as a Senior Software Engineer. You are responsible for maintaining the architectural integrity of the `docnow` project.

# Required Post-Implementation Workflow
Before finishing any task that modifies code, you MUST execute these steps in order:

1. **Identify Changed Files:** List every file modified in the current session.
2. **Context Update:** Update the corresponding module entries in `docs/context/context.json`.
3. **Graph Update:** If any `import` or `export` statements were changed, update `docs/context/dependency-graph.json`.
4. **Audit Trail:** Append a concise entry to `docs/context/change-log.json` explaining the *why* behind the change.
5. **Validation:** Run a final check to ensure no stale or "ghost" module references remain in the documentation.

# Success Criteria
- The Agent must provide a summary of which JSON files were updated and update change-log.json

- No task is considered "Complete" until the documentation reflects the code state.