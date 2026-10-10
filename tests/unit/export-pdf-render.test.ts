/**
 * Unit: `src/lib/pdf-render` — the Chromium driving extracted from the export
 * route (AR-01). Puppeteer and the filesystem probe are stubbed, so these tests
 * pin the launch-options contract and the cleanup guarantees without ever
 * starting a browser (the real rendering pipeline stays out of test scope).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  existsSync: vi.fn(),
  close: vi.fn(),
  setContent: vi.fn(),
  createPDFStream: vi.fn(),
}));

function puppeteerModule(): unknown {
  return {
    default: {
      launch: mocks.launch.mockImplementation(async () => ({
        newPage: async () => ({
          setContent: mocks.setContent,
          createPDFStream: mocks.createPDFStream,
        }),
        close: mocks.close,
      })),
    },
  };
}

function fsModule(): unknown {
  return { default: { existsSync: mocks.existsSync }, existsSync: mocks.existsSync };
}

// The stand-ins only cover what `pdf-render` calls, so their module shape is
// narrowed at the mock boundary instead of faking the whole Puppeteer typing.
vi.mock("puppeteer", () => puppeteerModule() as never);
vi.mock("node:fs", () => fsModule() as never);

import {
  DEV_CHROME_CANDIDATES,
  PROD_CHROMIUM_FALLBACK_PATH,
  buildPuppeteerLaunchOptions,
  renderPdfStream,
  resolveChromiumExecutablePath,
} from "@/lib/pdf-render";

/** Re-arms `launch` after a test replaced its implementation or rejected once. */
function restoreLaunchMock(): void {
  mocks.launch.mockReset();
  mocks.launch.mockImplementation(async () => ({
    newPage: async () => ({
      setContent: mocks.setContent,
      createPDFStream: mocks.createPDFStream,
    }),
    close: mocks.close,
  }));
}

/** A Chromium-like print stream: one chunk per array, then close or error. */
function printStream(chunks: Uint8Array[], failWith?: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (failWith) controller.error(failWith);
      else controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.existsSync.mockReset();
  restoreLaunchMock();
});

describe("resolveChromiumExecutablePath", () => {
  it("trusts the image's single Chromium path in production", () => {
    expect(resolveChromiumExecutablePath({ NODE_ENV: "production" })).toBe(
      PROD_CHROMIUM_FALLBACK_PATH,
    );
    expect(
      resolveChromiumExecutablePath({
        NODE_ENV: "production",
        PUPPETEER_EXECUTABLE_PATH: "/opt/chromium/chrome",
      }),
    ).toBe("/opt/chromium/chrome");
    // No probing happens in production, so the lookup stays cheap.
    expect(mocks.existsSync).not.toHaveBeenCalled();
  });

  it("prefers a configured executable outside production", () => {
    mocks.existsSync.mockImplementation((candidate: string) => candidate === "/configured/chrome");
    expect(
      resolveChromiumExecutablePath({
        NODE_ENV: "development",
        PUPPETEER_EXECUTABLE_PATH: "/configured/chrome",
      }),
    ).toBe("/configured/chrome");
  });

  it("falls back to locally installed Chrome in priority order", () => {
    mocks.existsSync.mockImplementation(
      (candidate: string) => candidate === DEV_CHROME_CANDIDATES[1],
    );
    expect(resolveChromiumExecutablePath({ NODE_ENV: "development" })).toBe(
      DEV_CHROME_CANDIDATES[1],
    );
    expect(mocks.existsSync).toHaveBeenNthCalledWith(1, DEV_CHROME_CANDIDATES[0]);
    expect(mocks.existsSync).toHaveBeenNthCalledWith(2, DEV_CHROME_CANDIDATES[1]);
  });

  it("returns undefined when nothing is installed, letting Puppeteer decide", () => {
    mocks.existsSync.mockReturnValue(false);
    expect(resolveChromiumExecutablePath({ NODE_ENV: "test" })).toBeUndefined();
  });

  it("treats an unreadable candidate as simply absent", () => {
    mocks.existsSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(resolveChromiumExecutablePath({ NODE_ENV: "test" })).toBeUndefined();
  });
});

describe("buildPuppeteerLaunchOptions", () => {
  it("keeps the hardened flags used inside containers", () => {
    expect(buildPuppeteerLaunchOptions({ NODE_ENV: "production" })).toEqual({
      headless: true,
      protocolTimeout: 60_000,
      // AR-06: the docker gate (2026-10-09) showed Chromium dying in GPU init
      // inside the image — every container export silently fell back to HTML
      // with `ProtocolError: Network.enable timed out`. These two flags are the
      // fix, so they are pinned rather than left to the implementation.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
      executablePath: PROD_CHROMIUM_FALLBACK_PATH,
    });
  });

  it("omits executablePath when no browser was found locally", () => {
    mocks.existsSync.mockReturnValue(false);
    const options = buildPuppeteerLaunchOptions({ NODE_ENV: "development" });
    expect(options).not.toHaveProperty("executablePath");
    expect(options.args).toEqual([
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ]);
  });

  it("always renders headless with a bounded protocol timeout", () => {
    const options = buildPuppeteerLaunchOptions({ NODE_ENV: "development" });
    expect(options.headless).toBe(true);
    expect(options.protocolTimeout).toBe(60_000);
    expect(options.args).toContain("--disable-gpu");
  });
});

describe("renderPdfStream", () => {
  const PDF_OPTIONS = {
    format: "A4",
    printBackground: true,
    timeout: 60_000,
    margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
  };

  it("hands back Chromium's print stream and closes the browser only once the body is consumed", async () => {
    mocks.createPDFStream.mockResolvedValue(
      printStream([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
    );

    const stream = await renderPdfStream("<html>report</html>", {
      NODE_ENV: "production",
      PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
    });

    expect(mocks.launch).toHaveBeenCalledWith(
      buildPuppeteerLaunchOptions({ NODE_ENV: "production" }),
    );
    expect(mocks.setContent).toHaveBeenCalledWith("<html>report</html>", {
      waitUntil: "load",
      timeout: 30_000,
    });
    expect(mocks.createPDFStream).toHaveBeenCalledWith(PDF_OPTIONS);

    // PF-02: the whole point of the stream is that the browser is still printing
    // (or has printed but not been drained) while the caller reads, so closing it
    // at the end of this function would truncate the document.
    expect(mocks.close).not.toHaveBeenCalled();

    expect(Array.from(await readAll(stream))).toEqual([1, 2, 3, 4]);
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
  });

  it("closes the browser when the client hangs up mid-download", async () => {
    let cancelled = false;
    mocks.createPDFStream.mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    const stream = await renderPdfStream("<html>report</html>", { NODE_ENV: "production" });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel("client disconnected");

    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(cancelled).toBe(true);
  });

  it("propagates a print failure to the reader and still closes the browser", async () => {
    mocks.createPDFStream.mockResolvedValue(
      printStream([new Uint8Array([1])], new Error("PrintConfigurationError")),
    );

    const stream = await renderPdfStream("<html>x</html>", { NODE_ENV: "production" });

    await expect(readAll(stream)).rejects.toThrow("PrintConfigurationError");
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
  });

  it("closes the browser when page rendering fails", async () => {
    mocks.createPDFStream.mockRejectedValueOnce(new Error("page died"));

    await expect(renderPdfStream("<html>x</html>", { NODE_ENV: "production" })).rejects.toThrow(
      "page died",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("propagates a launch failure without trying to close", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("no chromium"));

    await expect(renderPdfStream("<html>x</html>", { NODE_ENV: "production" })).rejects.toThrow(
      "no chromium",
    );
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
