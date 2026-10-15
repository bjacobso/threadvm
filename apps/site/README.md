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

Deploy `apps/site/dist` on any static host. Set the repository root as the install
and build directory, use `pnpm build:site` as the build command, and
`apps/site/dist` as the output directory. No server adapter or environment
variables are required. The site currently assumes it is served at the domain
root. Set `SITE_URL` to the final public origin at build time to generate
canonical URLs and absolute social-preview image URLs.

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
