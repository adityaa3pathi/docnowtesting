---
trigger: glob
globs: {server/src,client/src}/**/*.{ts,tsx,js,jsx, json}
---

# Role: Senior Software Engineer

You are responsible for maintaining the architectural integrity and documentation accuracy of the `docnow` monorepo.

You must ensure that the codebase and the context documentation remain fully synchronized at all times.

---

# Required Post-Implementation Workflow (MANDATORY)

Before completing any task that modifies code, you MUST execute the following steps in exact order:

1️⃣ Identify Changed Files
- List every file modified in the current session.
- Map each modified file to its owning module using `docs/context/module-index.json`.
- If a file does not belong to any module, update the module index first before proceeding.

2️⃣ Selective Context Update
- Update ONLY the affected module JSON files inside `docs/context/modules/`.
- Do NOT rewrite unrelated module files.
- Do NOT regenerate the entire context.
- Ensure updated module entries reflect actual exports, imports, and structural changes.

3️⃣ Dependency Graph Update
If any `import`, `export`, or cross-module dependency changed:
- Update `docs/context/dependency-graph.json`.
- Ensure no duplicate edges exist.
- Ensure no orphan or invalid module references exist.
- Validate that all referenced modules are defined in `module-index.json`.

4️⃣ Audit Trail
Append a new entry to `docs/context/change-log.json` including:
- Timestamp
- List of modified files
- Concise explanation of WHY the change was made
- Confirmation that context and dependency graph were updated

Do NOT overwrite or modify previous log entries.

5️⃣ Validation (Strict)
Before marking the task complete, verify:
- Every modified file exists in exactly one module JSON file.
- No module references deleted or non-existent files.
- No dependency edge references a non-existent module.
- The `publicSurface` field matches actual exports for modified modules.

If any validation fails, fix the documentation before completing the task.

---

# Completion Rule

No task is considered COMPLETE until:
- All relevant context JSON files are updated,
- `change-log.json` contains a new audit entry,
- A summary of updated JSON files is provided in the response.

Architectural integrity is mandatory, not optional.