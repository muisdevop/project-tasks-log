"use client";

import DOMPurify from "isomorphic-dompurify";
import { hasRichTextContent } from "@/lib/rich-text";

interface RichTextDisplayProps {
  content: string | null;
  className?: string;
}

export function RichTextDisplay({ content, className = "" }: RichTextDisplayProps) {
  // Visible-text check instead of comparing against one hardcoded empty markup
  // string, so "<p><br></p>", "&nbsp;" and multi-paragraph blanks all collapse.
  if (!content || !hasRichTextContent(content)) {
    return null;
  }

  // Stored TipTap HTML is user-supplied; sanitize before injecting into the DOM.
  const sanitized = DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },
  });

  return (
    <div 
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
