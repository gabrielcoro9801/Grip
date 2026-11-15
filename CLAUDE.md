## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. Each developer builds it on their own machine (graphify-out/ is gitignored); the hooks in `.claude/settings.json` keep it current.

Run graphify through `node .claude/hooks/graphify.mjs <command>`. It finds graphify even when it is not on the PATH. A bare `graphify <command>` also works where it is on the PATH.

Rules:
- When graphify-out/graph.json exists, run `node .claude/hooks/graphify.mjs query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `node .claude/hooks/graphify.mjs path "<A>" "<B>"` for relationships and `node .claude/hooks/graphify.mjs explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `node .claude/hooks/graphify.mjs section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- Code changes update the graph by themselves. The Stop hook runs `graphify update .` in the background at the end of every turn that changed code. Git hooks (post-merge, post-rewrite, post-checkout) do the same right after a pull or a branch switch, from any terminal or editor. The SessionStart hook installs those git hooks on each machine (they are not versioned) and catches anything they missed. If you need the graph current in the middle of a turn (for example, right after a refactor and before querying it), run `node .claude/hooks/graphify.mjs update .` yourself (AST only, no API cost, about 15 seconds).
- `graphify update` reads code only. After changing Markdown or HTML docs (README.md, server/README.md, docs/), tell the user to run `/graphify . --update` so those docs are re-read into the graph. It costs model tokens, so do not run it unasked.
- If the SessionStart hook says graphify is not installed or the graph does not exist, tell the user first, with the install steps it gives, then work by reading files normally.
