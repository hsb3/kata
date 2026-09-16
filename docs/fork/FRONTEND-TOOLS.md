# Frontend tooling

Project skills live in `.agents/skills`; `.claude/skills` and `.codex/skills`
are relative links to that directory. The committed Claude settings and Codex
example enable the project workbench and browser tools, while disabling tools
unrelated to this Svelte/Vite/Bun project. Machine-specific Codex configuration
and Atelier-generated roles stay ignored.

Copy the plugin and MCP sections from `.codex/config.example.toml` into the
ignored `.codex/config.toml`, preserving local Atelier settings, then start a
fresh Codex session. Claude also discovers project settings and `.mcp.json` in
a fresh session; approve the project MCP when Claude prompts. Project settings
are parsed configuration, not proof that a current process loaded them.

The minimal shared Svelte integration is the unauthenticated remote MCP at
`https://mcp.svelte.dev/mcp`, which offers documentation and static-analysis
tools. The official `sveltejs/ai-tools` plugin is optional for Svelte 5 skills
and specialist-agent workflows; it is not required for documentation lookup.

Sources: [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Svelte remote MCP](https://svelte.dev/docs/ai/remote-setup), [Svelte Codex plugin](https://svelte.dev/docs/ai/codex-plugin), and [Svelte Claude plugin](https://svelte.dev/docs/ai/claude-plugin).
