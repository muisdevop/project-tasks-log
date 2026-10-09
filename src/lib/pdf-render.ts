import fs from "node:fs";
import puppeteer from "puppeteer";

/**
 * Chromium driving for `/api/export` (AR-01).
 *
 * The browser pipeline itself is deliberately unchanged — `PUPPETEER_EXECUTABLE_PATH`
 * resolution, the same launch flags and the same A4 page options — because the
 * audit scopes rendering out of automated testing (a real browser launch in CI
 * would be slow and non-deterministic). Only the concerns were separated: this
 * module turns finished HTML into PDF bytes and throws on any browser failure so
 * the route can fall back to serving the HTML document.
 */

/** Candidate Chrome/Chromium binaries probed outside production, in priority order. */
export const DEV_CHROME_CANDIDATES: readonly string[] = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export const PROD_CHROMIUM_FALLBACK_PATH = "/usr/bin/chromium-browser";

export type PuppeteerLaunchOptions = NonNullable<
  Parameters<typeof puppeteer.launch>[0]
>;

/**
 * Outside production the operator's `PUPPETEER_EXECUTABLE_PATH` wins and local
 * Windows Chrome installs are probed so `npm run dev` works without config;
 * in production the image ships one known Chromium path.
 */
export function resolveChromiumExecutablePath(
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (env.NODE_ENV === "production") {
    return env.PUPPETEER_EXECUTABLE_PATH || PROD_CHROMIUM_FALLBACK_PATH;
  }

  const candidates = [env.PUPPETEER_EXECUTABLE_PATH, ...DEV_CHROME_CANDIDATES].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // An unreadable candidate is simply skipped, matching the previous
      // behaviour of swallowing filesystem probe errors during lookup.
    }
  }
  return undefined;
}

export function buildPuppeteerLaunchOptions(
  env: NodeJS.ProcessEnv,
): PuppeteerLaunchOptions {
  const options: PuppeteerLaunchOptions = {
    headless: true,
    protocolTimeout: 60_000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // AR-06, proven by the AGENTS.md docker gate on 2026-10-09: Alpine Chromium
      // inside the image has no usable GPU/EGL, so the GPU process died during
      // init (`eglInitialize … EGL_NOT_INITIALIZED`) and Puppeteer's CDP session
      // never became ready — `ProtocolError: Network.enable timed out` — which
      // made every container export silently fall back to HTML. `--disable-gpu`
      // is what makes the shipped PDF path actually work;
      // `--disable-dev-shm-usage` covers the 64 MB `/dev/shm` a container gets by
      // default, which a long report can otherwise exhaust mid-print.
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  };

  const executablePath = resolveChromiumExecutablePath(env);
  if (executablePath) options.executablePath = executablePath;
  return options;
}

/**
 * Render the report document to PDF bytes. Throws when the browser step fails.
 *
 * PF-02: this path is buffered on purpose. `page.setContent()` needs the whole
 * document and Chromium's `page.pdf()` resolves with the complete file, so there
 * is no incremental form of a PDF to stream. What the route does instead is keep
 * the source HTML alive only as a temporary argument, and the copy below is the
 * one `Response` body type the platform accepts (`BodyInit`), not a re-layout of
 * the report.
 */
export async function renderPdfBytes(
  html: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(buildPuppeteerLaunchOptions(env));

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      timeout: 60_000,
      margin: {
        top: "12mm",
        right: "12mm",
        bottom: "14mm",
        left: "12mm",
      },
    });
  } finally {
    await browser.close();
  }
}
