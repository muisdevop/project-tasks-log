import { describe, expect, it } from "vitest";
import { hasRichTextContent, richTextToPlainText } from "@/lib/rich-text";

describe("richTextToPlainText", () => {
  it("returns empty string for null, undefined and blank input", () => {
    expect(richTextToPlainText(null)).toBe("");
    expect(richTextToPlainText(undefined)).toBe("");
    expect(richTextToPlainText("")).toBe("");
  });

  it("strips tags and keeps visible text", () => {
    expect(richTextToPlainText("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(richTextToPlainText("<ul><li>one</li><li>two</li></ul>")).toBe("one two");
    expect(richTextToPlainText("plain text, no tags")).toBe("plain text, no tags");
  });

  it("treats every empty-editor variant as empty", () => {
    for (const html of ["<p></p>", "<p><br></p>", "<p> </p>", "<p>&nbsp;</p>", "<p></p><p></p>"]) {
      expect(richTextToPlainText(html)).toBe("");
    }
  });

  it("expands whitespace entities and zero-width markers", () => {
    expect(richTextToPlainText("a&nbsp;b")).toBe("a b");
    expect(richTextToPlainText("a&#160;b")).toBe("a b");
    expect(richTextToPlainText("a&#0160;b")).toBe("a b");
    expect(richTextToPlainText("a&#xa0;b")).toBe("a b");
    expect(richTextToPlainText("a&#xA0;b")).toBe("a b");
    expect(richTextToPlainText("a&#8203;b")).toBe("ab");
    expect(richTextToPlainText("a&zwj;b")).toBe("ab");
    expect(richTextToPlainText("a&ZWJ;b")).toBe("ab");
  });

  it("expands named and numeric entities after tag stripping", () => {
    expect(richTextToPlainText("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(richTextToPlainText("&lt;not a tag&gt;")).toBe("<not a tag>");
    expect(richTextToPlainText("&quot;quoted&quot;")).toBe('"quoted"');
    expect(richTextToPlainText("&#34;num&#34;")).toBe('"num"');
    expect(richTextToPlainText("&#039;single&#39;")).toBe("'single'");
    expect(richTextToPlainText("it&apos;s")).toBe("it's");
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(richTextToPlainText("  a \n\t  b  ")).toBe("a b");
    expect(richTextToPlainText("<p>a</p><p>b</p>")).toBe("a b");
    expect(richTextToPlainText("a\u00a0\u200b\ufeff b")).toBe("a b");
  });
});

describe("hasRichTextContent", () => {
  it("is true only when at least one visible character remains", () => {
    expect(hasRichTextContent("<p>hi</p>")).toBe(true);
    expect(hasRichTextContent("&amp;")).toBe(true);
    expect(hasRichTextContent("<p>a &amp; b</p>")).toBe(true);
  });

  it("is false for whitespace-only or empty variants", () => {
    for (const html of [null, undefined, "", "<p></p>", "<p><br></p>", "<p>&nbsp;&nbsp;</p>"]) {
      expect(hasRichTextContent(html)).toBe(false);
    }
  });
});
