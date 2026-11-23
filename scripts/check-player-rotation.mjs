// Phone-rotation check for the share-page player, in an emulated phone.
//
//   node scripts/check-player-rotation.mjs <baseUrl> <landscapeSlug> <portraitSlug> [--no-fs-api]
//
// <landscapeSlug> / <portraitSlug> are public share slugs of a 16:9 and a 9:16
// recording. It never presses play, so no views are logged. Default run uses
// the real Fullscreen API (Android). --no-fs-api switches it off to mimic
// iPhone Safari, where Plyr falls back to a fixed overlay. Exit code 0 = all pass.
//
// --inject re-creates the handlers in the page; it was only for checking browser
// behaviour before the first deploy.
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";

const [base, landSlug, portSlug] = process.argv.slice(2);
const inject = process.argv.includes("--inject");
const noFsApi = process.argv.includes("--no-fs-api"); // iPhone path: no Fullscreen API, Plyr overlay fallback
const P = { w: 412, h: 915 };

const INJECT = () => {
  const video = document.querySelector("video");
  const isPhone = () => matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 500;
  const isLandscape = () => screen.orientation.type.startsWith("landscape");
  let rotated = false;
  screen.orientation.addEventListener("change", () => {
    const fs = video.plyr.fullscreen;
    if (!isPhone()) return;
    if (!isLandscape()) { if (fs.active && rotated) fs.exit(); rotated = false; return; }
    if (fs.active || video.videoWidth <= video.videoHeight) return;
    const box = video.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight) return;
    rotated = true; fs.enter();
  });
  video.plyr.on("enterfullscreen", () => {
    if (rotated || video.videoWidth <= video.videoHeight || !isPhone() || isLandscape()) return;
    screen.orientation.lock("landscape").catch(() => {});
  });
  const s = document.createElement("style");
  s.textContent = "@media (orientation: landscape) and (max-height: 500px){.plyr-rounded .plyr__video-wrapper--fixed-ratio{max-height:calc(100svh - 2px)}}";
  document.head.appendChild(s);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  // Record orientation-lock calls without changing behaviour.
  if (noFsApi) await page.addInitScript(() => { for (const k of ["fullscreenEnabled", "webkitFullscreenEnabled"]) Object.defineProperty(Document.prototype, k, { get: () => false, configurable: true }); });
  await page.addInitScript(() => {
    window.__locks = [];
    const orig = screen.orientation.lock?.bind(screen.orientation);
    if (orig) screen.orientation.lock = (o) => { const p = orig(o); p.then(() => window.__locks.push(o + ":ok"), (e) => window.__locks.push(o + ":" + e.name)); return p; };
  });

  const rotate = async (landscape) => {
    const [width, height] = landscape ? [P.h, P.w] : [P.w, P.h];
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 2.625, mobile: true, screenWidth: width, screenHeight: height,
      screenOrientation: landscape ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 },
    });
    await page.waitForTimeout(900);
  };
  const state = () => page.evaluate(() => {
    const v = document.querySelector("video");
    const r = document.querySelector(".plyr").getBoundingClientRect();
    return {
      orient: screen.orientation.type, vp: [innerWidth, innerHeight],
      fullscreen: !!v.plyr.fullscreen.active, nativeFs: !!document.fullscreenElement,
      player: [Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      video: [v.videoWidth, v.videoHeight], coarse: matchMedia("(pointer: coarse)").matches, locks: window.__locks,
    };
  });
  const open = async (slug) => {
    await rotate(false);
    await page.goto(`${base}/v/${slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.plyr && v.videoWidth > 0; }, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    if (inject) await page.evaluate(INJECT);
  };
  const results = [];
  const check = async (name, expect) => {
    const s = await state();
    const ok = expect(s);
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${JSON.stringify(s)}`);
  };

  await open(landSlug);
  await check("1 upright, inline", (s) => !s.fullscreen && s.coarse);
  await rotate(true);
  await check("2 turned sideways -> full screen", (s) => s.fullscreen && s.player[1] === P.h && s.player[2] === P.w);
  await page.screenshot({ path: `${path.join(os.tmpdir(), "loomola-rotation-")}${inject ? "pre" : noFsApi ? "live-iphonepath" : "live"}-rotated-fullscreen.png` });
  await rotate(false);
  await check("3 turned back upright -> leaves full screen", (s) => !s.fullscreen && !s.nativeFs);

  await page.tap('[data-plyr="fullscreen"]');
  await page.waitForTimeout(900);
  await check("4 full-screen button while upright -> full screen, landscape lock requested", (s) => s.fullscreen && s.locks.some((l) => l.startsWith("landscape")));
  await page.tap('[data-plyr="fullscreen"]');
  await page.waitForTimeout(700);
  await check("5 button again -> leaves full screen", (s) => !s.fullscreen);

  await rotate(true);
  await check("6 sideways again -> full screen", (s) => s.fullscreen);
  await page.tap('[data-plyr="fullscreen"]');
  await page.waitForTimeout(700);
  await check("7 exit by button while sideways -> inline, whole player fits the screen", (s) => !s.fullscreen && s.player[2] <= s.vp[1]);
  await page.screenshot({ path: `${path.join(os.tmpdir(), "loomola-rotation-")}${inject ? "pre" : noFsApi ? "live-iphonepath" : "live"}-sideways-inline.png` });
  await rotate(false);
  await check("8 upright after manual exit -> still inline", (s) => !s.fullscreen);

  await page.evaluate(() => { const d = document.createElement("div"); d.style.height = "3000px"; document.body.appendChild(d); window.scrollTo(0, document.documentElement.scrollHeight); });
  await page.waitForTimeout(300);
  const scrolledPast = await page.evaluate(() => document.querySelector("video").getBoundingClientRect().bottom <= 0);
  await rotate(true);
  await check(`9 player scrolled off screen (${scrolledPast}) + sideways -> stays inline`, (s) => !scrolledPast || !s.fullscreen);

  await open(portSlug);
  await rotate(true);
  await check("10 portrait video + sideways -> stays inline", (s) => !s.fullscreen && s.video[0] < s.video[1]);

  console.log(errors.length ? `page errors: ${JSON.stringify(errors)}` : "no page errors");
  await browser.close();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
