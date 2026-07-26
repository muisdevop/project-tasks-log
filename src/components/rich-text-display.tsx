"use client";

import DOMPurify from "isomorphic-dompurify";

interface RichTextDisplayProps {
  content: string | null;
  className?: string;
}

export function RichTextDisplay({ content, className = "" }: RichTextDisplayProps) {
  if (!content || content.trim() === "<p></p>") {
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
