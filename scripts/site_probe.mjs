import assert from "node:assert/strict";
import { mkdir, copyFile } from "node:fs/promises";
import { withChrome, until } from "./lib/chrome.mjs";

const url = process.env.THREADVM_SITE_URL || "http://127.0.0.1:4321/";
const base = new URL(url);
await mkdir(".context", { recursive: true });
await mkdir("docs/images", { recursive: true });

const story = (key) => `document.querySelector('.story').dataset.${key}`;
/** Text inside the embedded outline. */
const frameText = `(document.querySelector('[data-frame]').contentDocument?.body?.innerText ?? '')`;

await withChrome(
  async ({ cdp, evaluate, navigate, resize, capture, errors }) => {
    // A short window keeps the demo mostly below the fold.
    await resize(1440, 640);
    await navigate(base.href);
    assert.equal(await evaluate(`document.querySelectorAll('h1').length`), 1);
    await until(
      () => evaluate(`${frameText}.includes('Launch shared team workspaces')`),
      "embedded outline loaded",
    );

    // The story waits until the demo is on screen.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(await evaluate(story("stage")), "Write");
    assert.ok(
      !(await evaluate(`${frameText}.includes('build the share dialog')`)),
      "Story started before the demo was visible",
    );

    // In view, it writes the bullet, sends it, and the agent asks.
    await resize(1440, 1100);
    await evaluate(`document.getElementById('demo').scrollIntoView()`);
    await until(
      () => evaluate(`${frameText}.includes('@cursor build the share dialog')`),
      "story writes its bullet",
    );
    await until(
      () => evaluate(`${story("stage")} === 'Delegate'`),
      "agent starts",
      10000,
    );
    await until(
      () => evaluate(`${story("stage")} === 'Answer'`),
      "agent asks",
      15000,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-step="Answer"]').getAttribute('aria-current')`,
      ),
      "step",
    );
    assert.equal(
      await evaluate(`document.querySelector('[data-detail="Answer"]').hidden`),
      false,
    );

    // Answering from the inline question hands the outline to the visitor.
    assert.ok(
      await evaluate(`(() => {
        const doc = document.querySelector('[data-frame]').contentDocument;
        const button = [...doc.querySelectorAll('.outline-pane button')]
          .find((b) => b.textContent.trim() === 'Compact popover');
        button?.click();
        return !!button;
      })()`),
      "inline answer button",
    );
    await until(
      () => evaluate(`${story("driving")} === 'Visitor'`),
      "visitor takes over",
    );
    await until(
      () => evaluate(`${story("stage")} === 'Review'`),
      "suggestions arrive",
      20000,
    );
    // With a person driving, nobody accepts on their behalf.
    await new Promise((resolve) => setTimeout(resolve, 9000));
    assert.equal(await evaluate(story("stage")), "Review");
    assert.match(
      await evaluate(
        `document.querySelector('[data-driver-label]').textContent`,
      ),
      /driving/,
    );
    await capture(".context/site-demo-review.png");

    // Replay starts a fresh room, and left alone the story plays to the end.
    await evaluate(`document.querySelector('[data-replay]').click()`);
    await until(
      () =>
        evaluate(
          `${story("stage")} === 'Write' && ${story("driving")} === 'Story'`,
        ),
      "replay resets",
    );
    await until(
      () => evaluate(`${story("stage")} === 'Answer'`),
      "replayed agent asks",
      20000,
    );
    await until(
      () => evaluate(`${story("stage")} === 'Review'`),
      "story answers for an absent visitor",
      25000,
    );
    await until(
      () => evaluate(`${story("stage")} === 'Done'`),
      "story accepts for an absent visitor",
      25000,
    );
    assert.ok(
      await evaluate(`${frameText}.includes('(full dialog with tabs)')`),
      "accepted rewording is in the outline",
    );
    assert.equal(await evaluate(story("driving")), "Story");

    // All in-page destinations, local pages, and screenshot links resolve.
    const references = await evaluate(
      `Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))`,
    );
    for (const href of new Set(references)) {
      const target = new URL(href, base);
      if (target.origin !== base.origin) continue;
      const response = await fetch(target);
      assert.equal(response.status, 200, `Broken local link: ${href}`);
      if (target.pathname === base.pathname && target.hash) {
        assert.ok(
          await evaluate(
            `!!document.getElementById(${JSON.stringify(decodeURIComponent(target.hash.slice(1)))})`,
          ),
          `Missing anchor ${href}`,
        );
      }
    }
    await evaluate(
      `document.querySelector('.capture').open = true; document.querySelectorAll('img').forEach(image => { image.loading = 'eager'; })`,
    );
    await until(
      () =>
        evaluate(
          `Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)`,
        ),
      "screenshots loaded",
    );
    await evaluate(`document.querySelector('.capture').open = false`);

    // The static outline folds like the real one.
    await evaluate(
      `document.querySelector('#idea .ol__branch .ol__branch > summary').click()`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('#idea .ol__branch .ol__branch').open`,
      ),
      false,
    );
    await evaluate(
      `document.querySelector('#idea .ol__branch .ol__branch > summary').click()`,
    );

    // Verify the layout at narrow, tablet, and desktop widths.
    for (const width of [360, 390, 768, 1024, 1440]) {
      await resize(width, 960);
      assert.ok(
        await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
        `Horizontal overflow at ${width}px`,
      );
    }
    await cdp("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.status-pill i')).animationName`,
      ),
      "none",
    );

    await resize(1440, 1100);
    await evaluate("window.scrollTo(0, 0)");
    await capture(".context/site-desktop.png");
    await copyFile(".context/site-desktop.png", "docs/images/site.png");
    await capture(".context/site-full.png", true);
    await resize(390, 844);
    await evaluate("window.scrollTo(0, 0)");
    await capture(".context/site-mobile.png");

    const notePaths = [
      "/notes/a-bullet-is-enough/",
      "/notes/three-histories/",
      "/notes/give-work-a-place/",
    ];
    for (const path of notePaths) {
      await navigate(new URL(path, base).href);
      assert.ok(
        await evaluate(
          `document.querySelector('.article__body').textContent.length > 1000`,
        ),
      );
      assert.equal(await evaluate(`document.querySelectorAll('h1').length`), 1);
      assert.ok(
        await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
        `Article overflow: ${path}`,
      );
    }
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      "Site probe passed: story waits until visible, plays, hands over to the visitor, replays to the end; local links and images, five viewport widths, reduced motion, and three articles.",
    );
    console.log(
      "Screenshots: .context/site-{desktop,mobile,full,demo-review}.png; docs/images/site.png",
    );
  },
);
