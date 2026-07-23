# Persistent development services

The development service manager keeps the standalone WebUI backend and the IDE MCP sidecar alive independently from
Electron. This shortens the edit/test loop and gives browser automation a stable surface.

```bash
bun run dev:services         # start or reuse backend, MCP and renderer HMR
bun run dev:services:status  # health, ownership, URLs and logs
bun run dev:browser          # ensure the browser surface is ready on http://127.0.0.1:5174
bun run dev:services:stop    # stop only processes owned by the manager
bun run start:fast           # Electron without repeating prepare:dev
```

Restart only the process you changed without touching the other two:

```bash
node scripts/dev/index.cjs restart mcp
node scripts/dev/index.cjs restart renderer
node scripts/dev/index.cjs restart webui
```

Run `bun run prepare:dev` again only after changing bundled runtimes, MCP build inputs, or the model gateway. Production
startup and packaged lifecycle are unchanged.

Environment overrides:

- `TOMNI_DEV_DATA_DIR`
- `TOMNI_DEV_WEBUI_PORT` (default `25809`)
- `TOMNI_DEV_MCP_PORT` (default `17890`)
- `TOMNI_DEV_RENDERER_PORT` (default `5174`; Electron keeps `5173`)
