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
  pdf: vi.fn(),
}));

function puppeteerModule(): unknown {
  return {
    default: {
      launch: mocks.launch.mockImplementation(async () => ({
        newPage: async () => ({
          setContent: mocks.setContent,
          pdf: mocks.pdf,
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
  renderPdfBytes,
  resolveChromiumExecutablePath,
} from "@/lib/pdf-render";

/** Re-arms `launch` after a test replaced its implementation or rejected once. */
function restoreLaunchMock(): void {
  mocks.launch.mockReset();
  mocks.launch.mockImplementation(async () => ({
    newPage: async () => ({ setContent: mocks.setContent, pdf: mocks.pdf }),
    close: mocks.close,
  }));
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
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: PROD_CHROMIUM_FALLBACK_PATH,
    });
  });

  it("omits executablePath when no browser was found locally", () => {
    mocks.existsSync.mockReturnValue(false);
    const options = buildPuppeteerLaunchOptions({ NODE_ENV: "development" });
    expect(options).not.toHaveProperty("executablePath");
    expect(options.args).toEqual(["--no-sandbox", "--disable-setuid-sandbox"]);
  });
});

describe("renderPdfBytes", () => {
  it("renders the document and always closes the browser", async () => {
    mocks.pdf.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const bytes = await renderPdfBytes("<html>report</html>", {
      NODE_ENV: "production",
      PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
    });

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(mocks.launch).toHaveBeenCalledWith(
      buildPuppeteerLaunchOptions({ NODE_ENV: "production" }),
    );
    expect(mocks.setContent).toHaveBeenCalledWith("<html>report</html>", {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    expect(mocks.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
      timeout: 60_000,
      margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when page rendering fails", async () => {
    mocks.pdf.mockRejectedValueOnce(new Error("page died"));

    await expect(renderPdfBytes("<html>x</html>", { NODE_ENV: "production" })).rejects.toThrow(
      "page died",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("propagates a launch failure without trying to close", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("no chromium"));

    await expect(renderPdfBytes("<html>x</html>", { NODE_ENV: "production" })).rejects.toThrow(
      "no chromium",
    );
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
