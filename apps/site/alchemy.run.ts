import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Only the comment provider needs GitHub credentials, and only PR stages use it.
// Keep its lazy credentials in the stack context, as in Schematics' preview stack.
const github = Layer.effect(
  GitHub.Providers,
  Provider.collection([GitHub.Comment]),
).pipe(
  Layer.provide(GitHub.CommentProvider()),
  Layer.provideMerge(GitHub.fromEnv()),
);

export default Alchemy.Stack(
  "threadvm-site",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), github),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const production = stage === "prod";
    const site = yield* Cloudflare.Website.StaticSite("Site", {
      // Explicit stage names keep previews isolated from the production Worker.
      name: production ? "threadvm-site" : `threadvm-site-${stage}`,
      ...(production ? { domain: "threadvm.com" } : {}),
      workersDev: true,
      cwd: "../..",
      // Turbo builds the outline and vendored Foldworks prerequisites on a fresh checkout.
      command: "pnpm exec turbo build --filter @threadvm/site",
      outdir: "apps/site/dist",
      env: { SITE_URL: production ? "https://threadvm.com" : "" },
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
      },
      memo: {
        include: [
          "apps/site/**",
          "apps/outline/**",
          "packages/**",
          "vendor/foldworks/**",
          "package.json",
          "pnpm-workspace.yaml",
          "turbo.json",
        ],
        lockfile: true,
      },
    });

    const pr = Number(process.env.PULL_REQUEST);
    if (Number.isSafeInteger(pr) && pr > 0 && stage === `pr-${pr}`) {
      const [owner, repository] = (
        process.env.GITHUB_REPOSITORY ?? "bjacobso/threadvm"
      ).split("/");
      if (!owner || !repository)
        throw new Error("GITHUB_REPOSITORY must be owner/repository");
      yield* GitHub.Comment("Preview", {
        owner,
        repository,
        issueNumber: pr,
        body: Output.interpolate`## ThreadVM website preview

${site.url}

Built from commit \`${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"}\`.

This link updates with each push and is removed when the PR closes.`,
        allowDelete: true,
      });
    }

    return { url: site.url };
  }),
);
