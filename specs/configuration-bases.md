# Configuration and bases

## Configuration

Project registry:

- default path: `examples/single-project/projects.yaml`
- override: `THREADVM_PROJECTS_FILE`
- format: YAML object keyed by project id

Versioned consumer config:

- schema: `packages/shared/src/config/HarnessConfig.ts`
- discovery order: CLI `--config`, `HARNESS_CONFIG`, current-directory
  `harness.yaml`, current-directory `harness.yml`
- relative paths resolve from the config directory
- `threadvm config check` validates and prints the resolved configuration
- repository ids and paths, auth tools, dev ports, task-branch prefixes, and
  mise config containment are validated before server startup
- the server currently projects this config into a read-only project and
  blocks task creation until base and multi-repository provisioning land

The version `1` contract contains:

- `project`: stable id and display name.
- `workspace`: absolute remote root and source OCI image.
- `base`: exe.dev base VM name, mise bootstrap configuration, interactive
  setup and verification commands, and the selected auth tools.
- `repositories`: unique ids, URLs, non-overlapping relative destinations,
  default branches, and `task` or `default` branch policies.
- `tasks`: post-clone commands plus the dev command and labeled ports.
- `terminal`: tmux session prefix.
- `agents`: default agent and pane commands.

The implemented CLI commands are:

```text
threadvm web [--config <path>]
threadvm dev [--config <path>]
threadvm config check [--config <path>]
```

`config check` prints the selected source, absolute config directory, resolved
mise config path, and decoded config as JSON. `web` and `dev` propagate the
invocation directory through `THREADVM_PROJECT_DIR`; the server independently
validates the selected config before binding its port.

When a versioned config is active, `ConfigService` exposes one compatibility
`Project` with `configKind: harness`. It is read-only: project save/delete
operations fail with an instruction to edit `harness.yaml`. `WorkspaceService`
rejects task creation for that project until the new base/multi-repository
orchestrator is implemented. This guard prevents the legacy single-repository
flow from partially provisioning a versioned project.

Local metadata store:

- default path: `~/.threadvm/store.json`
- override: `THREADVM_STORE_FILE`
- stores recoverable ThreadVM metadata by VM id

Ports:

- API server: `THREADVM_PORT`, default `3333`
- Vite dev server: `THREADVM_WEB_PORT`, default `5173`
- Vite proxies `/api` and `/rpc` to the API server

Mocks and overrides:

- `THREADVM_EXEDEV_MOCK=1` returns a synthetic exe.dev VM.
- `THREADVM_EXEDEV_MOCK_ID`, `THREADVM_EXEDEV_MOCK_NAME`, `THREADVM_EXEDEV_MOCK_HOST` customize the mock VM.
- `THREADVM_SSH_MOCK=1` returns synthetic SSH command output.
- `THREADVM_TERMINAL_COMMAND` overrides the terminal command launched by `TerminalBridge`.
- `THREADVM_TERMINAL_LOCAL_TMUX=1` enables local tmux session detection for terminal probes and local adapters.

## Planned Base and Multi-Repository Flow

Terminology is intentionally precise:

- **Source image:** an OCI image such as `exeuntu`, passed to `exe.dev new`.
- **Base:** a persistent exe.dev VM prepared for one project and user.
- **Task workspace:** an exe.dev VM copied from a ready base with `exe.dev cp`.

The planned base states are:

```text
creating
bootstrapping
setup-required
verifying
ready
stale
failed
deleting
```

Base creation should:

1. Load the validated versioned config.
2. Create `base.name` from `workspace.sourceImage`.
3. Create `workspace.root` and copy the consumer mise config and setup scripts.
4. Check out every configured repository at its destination and default branch.
5. Provision the terminal runtime.
6. Run `mise trust <config>` when configured, then run the declared
   `base.bootstrap.command` non-interactively from the workspace root.
7. Record deterministic bootstrap steps and safe output excerpts.
8. Transition to `setup-required` and open a dedicated interactive terminal for
   `base.setup.command`.
9. Run `base.setup.verify` without retaining its output or reading token values.
10. Sanitize transient shell history, temporary login artifacts, and agent
    transcripts while preserving required credential/config state.
11. Quiesce the VM and mark it `ready` only after every required check succeeds.

The example setup script is
`examples/multi-repo-mise/scripts/setup-base.sh`. It supports:

```text
setup-base.sh setup [github] [codex] [claude]
setup-base.sh check [github] [codex] [claude]
```

Without explicit arguments it reads `base.setup.auth` from `harness.yaml`. The
interactive mode launches the selected provider login commands; check mode
suppresses provider output and communicates readiness only through labels and
its exit status.

Cloning a task should:

1. Require a `ready` base and reject missing, failed, stale, or unverified bases.
2. Copy the base with exe.dev tag inheritance disabled.
3. Rewrite ThreadVM metadata and tags so the clone is never classified as a base.
4. Re-run the configured auth verification and repository access probes without
   logging secrets.
5. Move every `task` repository onto the generated task branch and leave
   `default` repositories on their configured default branches.
6. Run `tasks.afterClone` once from `workspace.root`.
7. Start `tasks.dev.command`, expose labeled ports, and attach the terminal.
8. Offer a targeted setup/re-login terminal when a copied credential is stale
   instead of rebuilding the base automatically.

The full mise bootstrap should normally run only while building or repairing a
base. Clone-time reconciliation exists for branch-dependent dependencies and
generated state, not for repeating machine setup.

### Credential invariants

A personalized base and every clone belong to one trust domain. Until a future
credential-injection mode exists:

- bases are private, personal, and unshared by default.
- sharing a base or clone requires an explicit warning and confirmation.
- ThreadVM metadata, local store files, tags, comments, API responses, SSE
  events, and provisioning excerpts must never contain credential values.
- authentication commands run only in an interactive terminal whose output is
  not added to provisioning logs.
- verification commands must not use token-printing flags or inspect credential
  files directly.
- deleting a base does not imply provider-side revocation and does not remove
  credentials already copied into clones.
- team use should prefer future scoped integrations, credential helpers,
  gateways, or short-lived per-clone injection.
