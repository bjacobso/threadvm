# ThreadVM field notes

A static Astro site for sharing the ThreadVM exploration. It is styled with the
outliner's own tokens and marks, and its homepage embeds the actual outliner as
a controlled demo. It builds without a running ThreadVM server or agent
credentials.

From the repository root (Node.js 24.14+ and pnpm 10.20):

```sh
git submodule update --init vendor/foldworks
pnpm install
pnpm --filter './vendor/foldworks/packages/*' build
pnpm dev:site                 # http://localhost:4321
pnpm check:site               # Astro diagnostics
pnpm build:site               # apps/site/dist
pnpm --filter @threadvm/site preview
```

## Deployment

[`alchemy.run.ts`](alchemy.run.ts) deploys this site as a Cloudflare Worker with
static assets, using the same Alchemy version and remote `Cloudflare.state()`
store as the other projects. The stack is `threadvm-site`; it is separate from
the existing outline demo's `ThreadvmOutline` stack.

| Trigger                                         | Stage         | Worker                      | URL                                         |
| ----------------------------------------------- | ------------- | --------------------------- | ------------------------------------------- |
| Push to `main` or manual production workflow    | `prod`        | `threadvm-site`             | `https://threadvm.com`                      |
| Same-repository PR opened, reopened, or updated | `pr-<number>` | `threadvm-site-pr-<number>` | Isolated `workers.dev` URL posted on the PR |
| Same-repository PR closed or merged             | `pr-<number>` | Deleted                     | Preview comment removed                     |

Production is the only stage that binds the custom domain. Preview deployments
do not modify its DNS or route. The Alchemy-managed comment updates on each push,
identifies the deployed commit, and is removed with the preview. Fork PRs do not
receive deployment credentials and are skipped. Deploys and cleanup for one PR
share a concurrency group, with cancellation disabled to avoid interrupted state
updates. Cleanup checks out the deployed head SHA so it works after the branch
or merge ref is deleted.

### One-time Cloudflare and GitHub setup

1. Put `threadvm.com` in the intended Cloudflare account as an active zone, and
   enable that account's `workers.dev` subdomain. The domain must be available for
   this Worker's custom-domain binding.
2. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in this repository's
   **Settings → Secrets and variables → Actions**. Repository secrets serve both
   workflows; production can also use secrets from the `production` environment.
3. Scope the token to the deployment account and the `threadvm.com` zone. It needs
   Workers Scripts and Secrets Store write access (including Alchemy's remote
   state), account settings access for the Workers subdomain, zone read access,
   and Workers Routes write access for the custom domain. See
   [Alchemy's CI credentials guide](https://alchemy.run/environments/ci/) and
   [Cloudflare's Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/).
4. Enable Actions and allow its `GITHUB_TOKEN` to write PR comments. The preview
   workflow requests `pull-requests: write`; no separate GitHub PAT is needed.

The first Alchemy run can bootstrap the account's shared state-store Worker and
Secrets Store entries. CI uses `--yes` for this. Keep the same Cloudflare account
and remote state for later deploys and cleanup; `.alchemy/` stays ignored.

From the repository root, with Cloudflare credentials in the environment or an
Alchemy profile:

```sh
pnpm plan:site                   # production plan (requires Cloudflare access)
pnpm deploy:site --yes           # build prerequisites + deploy threadvm.com
pnpm --filter @threadvm/site run deploy --stage pr-123 --yes
```

For a manual preview to also update a PR comment, set `PULL_REQUEST=123`,
`GITHUB_REPOSITORY=bjacobso/threadvm`, `GITHUB_SHA`, and `GITHUB_TOKEN`.
The workflows in `.github/workflows/site-{production,preview}.yml` supply these.
Only destroy preview stages when cleaning up manually:

```sh
PULL_REQUEST=123 pnpm --filter @threadvm/site run destroy --stage pr-123 --yes
```

Removing an Alchemy-managed comment also requires `GITHUB_TOKEN`.

Alchemy builds through Turbo from the repository root, so a fresh CI checkout
builds the required Foldworks and outline packages automatically. Production
sets `SITE_URL=https://threadvm.com` to generate canonical and social image URLs;
previews clear it so they do not advertise the production origin. Build memoization
includes site, outline, shared, and vendored source plus the workspace lockfile.

For another static host, build with
`pnpm exec turbo build --filter @threadvm/site` and publish `apps/site/dist`.
No server adapter is required. The site assumes it is served at the domain root;
set `SITE_URL` to that host's public origin for canonical and social image URLs.

## Development builds

`dev` and `build` first run `pnpm demo`, which builds `apps/outline` with
`vite build --mode embed` into `public/demo/` (ignored by Git). Rerun it after
changing the outline app while `astro dev` is running.

## The demo

`/demo/` is the real Foldkit outliner. In embed mode its socket connects to
`apps/outline/src/embed/room.ts` instead of a server: the same seed, simulator,
and protocol as the Cloudflare `OutlineRoom`, played with timers in the page.
Nothing is sent anywhere, and a reload starts over.

A director in the room tells a short story once the page reports the frame is
in view: it types `@cursor build the share dialog`, sends it, answers Cursor's
question, and accepts its suggestions, waiting a few seconds each time for the
visitor to do it instead. Any edit, answer, or review from the visitor stops
the director; the agents keep running. The frame posts each stage to the page,
which highlights the matching step in `src/components/Demo.astro`. Replay
reloads the frame.

## Content and screenshots

- `src/pages/index.astro`: landing page, first principles, and architecture.
- `src/components/Demo.astro`: the embedded outline and its story steps.
- `src/components/Outline.astro`: static outlines drawn with the outliner's
  marks; branches fold with `<details>`.
- `src/styles/global.css`: the outliner's shadcn theme and agent colors, in
  light and dark.
- `src/content/notes.ts`: editable field notes; each generates a standalone page
  under `/notes/` and links to the implementation or design document.
- `public/screenshots/`: real local app screenshots with a seeded example project
  and pending CLI proposals. They do not show a live model run.
- The site uses the outliner's system font stack and makes no font requests.
  TypeScript 6 is scoped to this package because `astro check` does not
  support the repository’s TypeScript 7 yet.

To regenerate the app captures after building the workspace:

```sh
pnpm build
node scripts/capture_outline.mjs
```

The capture script runs a temporary Git project and the actual local server,
submits proposals through the CLI, captures the Inbox and review panel using
headless Chrome, and removes the temporary project. Set `CHROME_BIN` to override
the default `google-chrome` executable. Original captures go under `.context/`
and are copied to the site's public screenshot directory.

To check the built site in Chrome and refresh the README image, keep the preview
server running in one terminal and run the probe in another:

```sh
pnpm build:site
pnpm --filter @threadvm/site preview
# In another terminal:
pnpm probe:site
```

The probe checks that the story waits until the demo is in view, plays, hands
over when the visitor answers, and replays to the end on its own. It also checks
local links and images, responsive layout, reduced motion, and all three article
pages. It takes about a minute, writes desktop, mobile, review, and full-page
screenshots under `.context/`, and copies the desktop image to
`docs/images/site.png`. Set `THREADVM_SITE_URL`
if testing a different address.
