"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { useState, useEffect } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder = "Enter description..." }: RichTextEditorProps) {
  const [isFocused, setIsFocused] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
          HTMLAttributes: {
            class: "font-bold text-zinc-900 dark:text-zinc-100",
          },
        },
        paragraph: {
          HTMLAttributes: {
            class: "text-sm leading-relaxed mb-2",
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: "list-disc ml-4 mb-2",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal ml-4 mb-2",
          },
        },
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
        HTMLAttributes: {
          class: "text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300",
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
        validate: (href) => {
          return /^https?:\/\//.test(href) || /^mailto:/.test(href) || /^\//.test(href);
        },
      }),
      Underline.configure({
        HTMLAttributes: {
          class: "underline",
        },
      }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML() || "");
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[100px] p-4 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 transition-all duration-200 ${
          isFocused ? "ring-2 ring-blue-500 border-transparent" : ""
        } hover:border-zinc-400 dark:hover:border-zinc-600`,
        placeholder: placeholder,
      },
    },
    parseOptions: {
      preserveWhitespace: true,
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "");
    }
  }, [value, editor]);

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Enter URL (https:// required):", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const sanitizedUrl = url.trim();
      if (/^https?:\/\//.test(sanitizedUrl) || /^mailto:/.test(sanitizedUrl) || /^\//.test(sanitizedUrl)) {
        editor.chain().focus().extendMarkRange("link").setLink({ href: sanitizedUrl }).run();
      } else {
        alert("Invalid URL. Must start with http://, https://, mailto:, or /");
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Toolbar - grouped like WordPress */}
      <div className="flex flex-wrap gap-1 p-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800">
        {/* Text Formatting */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("bold") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Bold (Ctrl+B)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M6 3a1 1 0 011-1h4.5a3.5 3.5 0 010 7H8a1 1 0 110-2V3zm2 2v3h3.5a1.5 1.5 0 100-3H8z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("italic") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Italic (Ctrl+I)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8 2a1 1 0 00-1 1v14a1 1 0 102 0V2a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={!editor.can().chain().focus().toggleUnderline().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("underline") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Underline (Ctrl+U)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zM3 8a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM4 13a1 1 0 100 2h12a1 1 0 100-2H4z" />
          </svg>
        </button>

        <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-600 mx-1" />

        {/* Headings - Limited to H1-H3 for security */}
        <select
          onChange={(e) => {
            const level = e.target.value;
            if (level === "paragraph") {
              editor.chain().focus().setParagraph().run();
            } else if (level) {
              editor.chain().focus().toggleHeading({ level: parseInt(level) as 1 | 2 | 3 }).run();
            }
          }}
          value={editor.isActive("heading") ? editor.getAttributes("heading").level?.toString() || "paragraph" : "paragraph"}
          className="h-8 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
        >
          <option value="paragraph">Normal</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>

        <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-600 mx-1" />

        {/* Lists */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={!editor.can().chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("bulletList") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Bullet List"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={!editor.can().chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("orderedList") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Numbered List"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm0 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm0 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
            <path d="M2 4a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2z" />
          </svg>
        </button>

        <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-600 mx-1" />

        {/* Link - with security validation */}
        <button
          type="button"
          onClick={setLink}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("link") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Add Link"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      </div>

      {/* Editor Content */}
      <div 
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
