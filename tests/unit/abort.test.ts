import { describe, expect, it } from "vitest";

import { isCancelledRequest } from "@/lib/abort";

describe("isCancelledRequest", () => {
  it("accepts the DOMException a browser raises when a request is aborted", () => {
    expect(isCancelledRequest(new DOMException("The user aborted a request.", "AbortError"))).toBe(
      true,
    );
  });

  it("accepts an Error subclass that carries the AbortError name", () => {
    const error = new Error("request cancelled");
    error.name = "AbortError";
    expect(isCancelledRequest(error)).toBe(true);
  });

  it("rejects genuine failures and non-errors", () => {
    expect(isCancelledRequest(new TypeError("Failed to fetch"))).toBe(false);
    expect(isCancelledRequest(new Error("AbortController was not the reason"))).toBe(false);
    expect(isCancelledRequest("AbortError")).toBe(false);
    expect(isCancelledRequest(undefined)).toBe(false);
    expect(isCancelledRequest(null)).toBe(false);
  });

  it("matches the rejection a real already-aborted fetch produces", async () => {
    const controller = new AbortController();
    controller.abort();

    const reason = await fetch("http://127.0.0.1:9/ping", { signal: controller.signal }).catch(
      (error: unknown) => error,
    );

    expect(reason).toBeInstanceOf(Error);
    expect(isCancelledRequest(reason)).toBe(true);
  });
});
