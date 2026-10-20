import fs from "node:fs";
import puppeteer from "puppeteer";

/**
 * Chromium driving for `/api/export` (AR-01).
 *
 * The browser pipeline itself is deliberately thin — `PUPPETEER_EXECUTABLE_PATH`
 * resolution, the launch flags and the A4 page options are the whole contract —
 * because the unit and integration suites mock Puppeteer to stay deterministic and
 * parallel-safe. Real Chromium rendering is verified one layer up, by the AGENTS.md
 * container gate: `scripts/container-smoke.mjs` with `REQUIRE_PDF=1` prints a PDF
 * using the image's own Chromium on both providers, and CI runs it on every push.
 * Only the concerns were separated: this module turns finished HTML into a PDF
 * stream and throws on any browser failure so the route can fall back to serving
 * the HTML document.
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
 * Render the report document as a PDF *stream*. Throws when the browser step
 * fails, before any stream exists, so the route can fall back to the HTML report.
 *
 * PF-02: this used to be `page.pdf()` returning one finished buffer, justified in
 * the comment as "there is no incremental form of a PDF to stream". That claim was
 * false for the pinned Puppeteer — `page.createPDFStream()` has returned a
 * `ReadableStream<Uint8Array>` since v22, and this repository pins 24 — so the
 * printed document now goes to the response as the bytes arrive instead of being
 * held in memory next to the HTML it was rendered from.
 *
 * What genuinely cannot be streamed is the input: `page.setContent()` needs the
 * whole document, so the report HTML is still one string here. That is the honest
 * residual, and it is why the HTML fallback path (which needs no browser) chunks
 * its own output instead of building the same string.
 *
 * The browser must outlive this function: closing it as soon as the print call
 * returned would truncate the document mid-stream. Cleanup therefore happens on
 * the stream itself — when the body is exhausted, when it errors, or when the
 * client hangs up — and every one of those three paths is pinned by a test.
 */
export async function renderPdfStream(
  html: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadableStream<Uint8Array>> {
  const browser = await puppeteer.launch(buildPuppeteerLaunchOptions(env));

  let printable: ReadableStream<Uint8Array>;
  try {
    const page = await browser.newPage();
    // `load` (not `networkidle0`): puppeteer 24.43 dropped the networkidle options
    // from this type, and for a document handed over whole by `setContent()` the load
    // event already means every referenced resource has finished — the extra idle
    // window was waiting for nothing.
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    printable = await page.createPDFStream({
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
  } catch (error) {
    // Nothing was handed to the caller, so nothing is left to clean up later.
    await browser.close();
    throw error;
  }

  return closedWhenDrained(printable, () => browser.close());
}

/**
 * Re-expose `source` so that `close` runs exactly once, whether the body was read
 * to the end, failed inside Chromium, or was abandoned by the client.
 */
function closedWhenDrained(
  source: ReadableStream<Uint8Array>,
  close: () => Promise<unknown>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await close();
    } catch {
      // A browser that refuses to shut down is not worth failing a download over.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await closeOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        await closeOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await closeOnce();
    },
  });
}
