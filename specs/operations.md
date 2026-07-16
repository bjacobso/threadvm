# Operations and verification

## Runtime entry points

- API and production UI server: `THREADVM_PORT`, default `3333`.
- Vite development server: `THREADVM_WEB_PORT`, default `5173`.
- Vite proxies `/api` and `/rpc` to the API server.
- the production server serves `apps/web/dist` as an SPA when present.
- API documentation is available at `/docs` and `/docs/openapi.json`.

## Configuration and mock overrides

- `THREADVM_PROJECTS_FILE` selects the legacy project registry.
- `HARNESS_CONFIG` selects an explicit versioned consumer config.
- `THREADVM_PROJECT_DIR` preserves the CLI invocation directory for config discovery.
- `THREADVM_STORE_FILE` selects the local metadata cache.
- `THREADVM_EXEDEV_MOCK=1` returns a synthetic exe.dev VM.
- `THREADVM_EXEDEV_MOCK_ID`, `THREADVM_EXEDEV_MOCK_NAME`, and `THREADVM_EXEDEV_MOCK_HOST` customize it.
- `THREADVM_SSH_MOCK=1` returns synthetic SSH output.
- `THREADVM_TERMINAL_COMMAND` overrides the terminal bridge command.
- `THREADVM_TERMINAL_LOCAL_TMUX=1` enables local tmux probes and adapters.

## Scripts

Root scripts:

```text
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm start
pnpm probe:terminal
pnpm probe:config
pnpm probe:boundaries
pnpm probe:dev
pnpm probe:web-style
pnpm probe:terminal-ui
```

Probe scripts:

- `scripts/config_probe.ts`
- `scripts/workspace_boundary_probe.ts`
- `scripts/web_style_probe.ts`
- `scripts/dev_probe.mjs`
- `scripts/terminal_probe.mjs`
- `scripts/terminal_ui_probe.ts`

## Release-quality verification

A change is ready for handoff when the checks proportional to its scope pass. The normal full set is:

```sh
pnpm typecheck
pnpm build
pnpm probe:config
pnpm probe:boundaries
pnpm probe:web-style
pnpm probe:terminal
```

UI changes should also be exercised against the running Vite client. Remote workspace changes should include one mock-backed automated path and one read-only or disposable live exe.dev smoke test when credentials and infrastructure are available.
