# Outline

An outline you think in, with agents that work beside you. Write bullets,
mention `@claude`, `@cursor`, `@codex`, or `@conductor`, and the bullet becomes
a task. The agent works in its own sandbox with that branch of the outline as
context, asks when it needs you, and reports back as suggestions you accept or
reject.

This directory now contains two modes. **Local mode** is served by `threadvm open`
and connects Foldworks editing to the Git outline store, CLI proposals, worktrees,
tmux, the existing terminal gateway and the ACP runner. Its source is `src/local`;
launching an agent always requires an explicit Run action. See the root README.

**Embed mode** (`pnpm build:embed`) builds the same demo for the homepage in
`apps/site`: `src/embed/room.ts` plays the room in the page, with a short
scripted story on top. See the site README.

**Cloudflare demo mode**, described below, is an experience prototype. Its agents are deterministic simulations played
by a Durable Object. The demo does not connect to the local harness.

## Using it

- **Write.** The outline is `@foldworks/outliner`. Use Return for a new bullet,
  Tab and Shift+Tab to nest, ⌘↑ and ⌘↓ to fold, ⌘. to hoist, ⌘Z to undo, and
  drag a bullet to move it. Type `@` for agent completions; hover a mention to
  see who it is.
- **Ask an agent.** A bullet that mentions an agent is sent when the caret
  leaves it, after a short countdown. Go back to the bullet to keep editing,
  click the chip to send it now, or choose **Keep as note**.
- **Answer.** When an agent needs input, its question appears as a highlighted
  row under the bullet that asked, with one-click answers. You can also answer
  from the inbox or the thread panel.
- **Notice.** Every folded branch shows how many agents below it are waiting on
  you, have suggestions, or are working. The header shows totals for the whole
  outline. Press ⌘J (Ctrl+J elsewhere) to jump to the next request.
- **Review.** Suggestions arrive as tracked changes: green rows for new bullets,
  struck and green text for rewording, and "✓ mark done" for completions.
  Accept or reject each one, or review them all in the thread panel's tree
  diff. Accepting is one undoable step; undoing it brings the suggestion back.
- **Delegate.** Accepted bullets that mention an agent start right away, so
  `@conductor` plans become parallel work and `@claude` can hand review to
  `@codex`. Delegation stops two levels down.
- **Steer.** Open a thread to see its sandbox, the outline it can see, and its
  activity. Message it while it works, stop it, or ask a finished agent for a
  follow-up.

Each outline lives at `/o/<id>`. Opening `/` starts a new one from the demo
outline; share the URL to work in the same outline from another window. The
reset button in the header restores the demo.

## How it is built

```text
Browser: Foldkit app (Model, Message, update, view)
  @foldworks/outliner, text-intelligence, ui, history
  | one WebSocket per outline, Effect Schema messages
  v
Cloudflare Worker (Effect, deployed with Alchemy)
  serves the client build, routes /api/outlines/:id/socket
  v
OutlineRoom Durable Object (Effect), one per outline
  document + threads in storage, scripted runs on scheduled alarms
```

- `src/shared/protocol.ts` is the wire contract: outline items, threads,
  activity, questions, and suggestion ops. Client and server both decode with
  it.
- `src/shared/tree.ts` applies accepted suggestions and computes an agent's
  context: the path to its bullet and the branch beneath it.
- `src/worker/OutlineRoom.ts` owns the document and threads, relays outline
  edits between windows, and plays each run one beat at a time. Timed beats
  finish from scheduled events, so runs survive the object being evicted.
- `src/worker/simulator.ts` holds the agents' scripts. A real harness would
  replace this file and stream the same `Thread` updates.
- `src/client/projection.ts` renders suggestions and questions as read-only
  "ghost" rows inside the outliner. They fold and nest with everything else,
  but they are projected from threads after every update and never saved.
- `src/client/update.ts` is the Foldkit update: completions, countdowns,
  dispatch, review, undo/redo resync, and the room connection. Each update
  sends its outgoing messages in one ordered batch, so the room always sees an
  outline save before a dispatch that depends on it.

The Foldworks packages come from `vendor/foldworks`, a git submodule, because
`@foldworks/outliner` and `@foldworks/text-intelligence` are not published yet.
The workspace catalog pins the Foldkit, Effect, and StyleX versions they build
against.

## Development

```sh
git submodule update --init vendor/foldworks
pnpm install
pnpm --filter './vendor/foldworks/packages/*' build
pnpm --filter @threadvm/outline dev:demo
```

`dev:demo` runs two processes:

- `dev:worker` runs `alchemy dev` with local state, so the Worker and Durable
  Objects run in workerd on `http://localhost:1337` without a Cloudflare
  account.
- `dev:client` runs Vite on `http://localhost:5180` with hot reload, and proxies
  `/api` to the Worker.

`dev:worker` serves the `dist` that existed when it started. To check the
production bundle on port 1337, run `pnpm build` and restart `dev:worker`.

```sh
pnpm --filter @threadvm/outline typecheck
pnpm --filter @threadvm/outline test
```

## Deploying

```sh
pnpm --filter @threadvm/outline exec alchemy login
pnpm --filter @threadvm/outline run deploy
```

`run deploy` builds the client and runs `alchemy deploy --stage prod`. Alchemy
keeps its state in Cloudflare and prints the Worker URL. `run destroy` removes
the stack. To add a custom domain, set `domain` on the Worker in
`src/worker/Api.ts`.

## Not yet

- Real agent harnesses, sandboxes, repositories, and authentication.
- Concurrent editing beyond last-writer-wins: each save replaces the outline.
  Two people typing in the same bullet at once will overwrite each other.
- Suggestions anchor to bullet ids. If the anchor is deleted, its suggestions
  disappear from the outline but stay in the thread.

For local harness development, run `pnpm dev` at the repository root. This runs
only the local API and Foldkit Vite app, without Cloudflare credentials. Set
`THREADVM_PROJECT_DIR` to an initialized project. The first `pnpm build` supplies
the reusable inventory/terminal bundle. Vite proxies local API, terminal and
inventory routes to the server; the Cloudflare simulator remains opt-in.
