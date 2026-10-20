import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";

describe("sanitizeHtml", () => {
  it("returns empty string for null, undefined and empty input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("removes script elements and their content", () => {
    expect(sanitizeHtml("<script>alert(1)</script><p>safe</p>")).toBe("<p>safe</p>");
  });

  it("strips inline event handlers but keeps the element", () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x">');
    expect(sanitizeHtml('<p onclick="steal()">text</p>')).toBe("<p>text</p>");
  });

  it("keeps allowed formatting tags", () => {
    expect(sanitizeHtml("<p>a <b>bold</b> <i>italic</i></p>")).toBe(
      "<p>a <b>bold</b> <i>italic</i></p>",
    );
    expect(sanitizeHtml('<ul><li><a href="https://example.com">link</a></li></ul>')).toContain(
      "<a href=",
    );
  });

  it("neutralises javascript: URLs", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe("<a>click</a>");
  });

  it("leaves plain text untouched", () => {
    expect(sanitizeHtml("just words")).toBe("just words");
  });
});
