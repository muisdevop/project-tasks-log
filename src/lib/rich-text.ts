/**
 * Rich-text helpers shared by every component that renders or validates TipTap HTML.
 *
 * A saved empty editor is not always the literal string `<p></p>`: it can be
 * `<p><br></p>`, `<p> </p>`, `<p>&nbsp;</p>`, several empty paragraphs, or a
 * wrapper element holding nothing but whitespace. Checking one hardcoded string
 * left those variants rendering an empty prose box (UI-09).
 */

const TAG_PATTERN = /<[^>]*>/g;

/** HTML entities that browsers render as (near-)invisible characters. */
const WHITESPACE_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&#0*160;/gi, " "],
  [/&#0*xa0;/gi, " "],
  [/&#8203;/gi, ""],
  [/&zwj;/gi, ""],
];

const NAMED_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0*34;/g, '"'],
  [/&#0*39;/g, "'"],
  [/&apos;/gi, "'"],
];

/** Converts stored rich-text HTML into the plain text a reader would actually see. */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";

  let text = html.replace(TAG_PATTERN, " ");
  for (const [pattern, replacement] of WHITESPACE_ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of NAMED_ENTITIES) {
    text = text.replace(pattern, replacement);
  }

  // Includes   (non-breaking space) and zero-width characters.
  return text.replace(/[\s\u00a0\u200b\ufeff]+/g, " ").trim();
}

/** True when the stored HTML would display at least one visible character. */
export function hasRichTextContent(html: string | null | undefined): boolean {
  return richTextToPlainText(html).length > 0;
}
