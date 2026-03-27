"use client";

interface RichTextDisplayProps {
  content: string | null;
  className?: string;
}

export function RichTextDisplay({ content, className = "" }: RichTextDisplayProps) {
  if (!content || content.trim() === "<p></p>") {
    return null;
  }

  return (
    <div 
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
