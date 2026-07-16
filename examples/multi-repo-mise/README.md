# Multi-repository mise project

This directory is an example of a project that uses Harness as a tool instead
of containing Harness itself. The intended invocation is:

```sh
cd examples/multi-repo-mise
npx @threadvm/cli web
```

The package name is not published yet, but the CLI implements this config
contract. Validate the current directory without starting a server:

```sh
threadvm config check
```

The CLI resolves configuration in this order:

1. `--config <path>`
2. `HARNESS_CONFIG`
3. `harness.yaml` or `harness.yml` in the current directory

Relative paths in `harness.yaml` are resolved from the directory containing
that file, not from the Harness installation directory.

The current server exposes this config as a read-only project and refuses task
creation with an explicit error. Base creation and multi-repository
provisioning are the next runtime slice.

## Base

For this example, Harness would:

1. Create `acme-platform-base` from `exeuntu`.
2. Create `/work/acme-platform` in the VM.
3. Check out the API, web, and shared-contract repositories at their configured
   paths and default branches.
4. Copy `mise.toml` to `/work/acme-platform/mise.toml`.
5. Run the following non-interactively from `/work/acme-platform`:

   ```sh
   mise trust ./mise.toml
   mise bootstrap --yes
   ```

6. Open an interactive terminal and run:

   ```sh
   mise run base:setup
   ```

   The [`setup-base.sh`](scripts/setup-base.sh) script reads the tools from
   `base.setup.auth`, then walks through GitHub CLI, Codex, and Claude Code
   login. Rerunning it skips tools whose authentication is already valid.

7. Verify the base without displaying account details or token values:

   ```sh
   mise run base:check
   ```

8. Mark the base ready only after bootstrap and authentication checks succeed.

`mise bootstrap` installs the configured tools and invokes the
`tasks.bootstrap` task. That task should be safe to run again after a failed or
interrupted bootstrap.

The `base` section deliberately separates deterministic `bootstrap` work from
interactive `setup`. Harness should not capture terminal output excerpts while
the authentication setup command is active, and it must never copy credentials
into local Harness metadata. Cloning the VM still clones its credential-bearing
filesystem, so this example describes a private, single-user base rather than a
shareable team image.

## Task workspaces

Creating a task workspace clones the ready base VM. Harness then creates the
task branches described by each repository's `branch` policy, writes workspace
metadata, and starts `mise run dev` from the workspace root.

The repositories and commands below are illustrative placeholders. A real
consumer directory would normally be checked into an internal configuration
repository so the whole team shares the same Harness setup.
