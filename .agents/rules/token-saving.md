---
trigger: glob
globs: {server/src,client/src}/**/*.{ts,tsx,js,jsx, json}
---

Before making modifications:

1. Read module-index.json.
2. Identify relevant modules.
3. Load only those module JSON files.
4. Load dependency-graph.json only if cross-module impact exists.
5. Do not load unrelated modules.