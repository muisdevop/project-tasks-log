"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
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
        heading: false,
        paragraph: {
          HTMLAttributes: {
            class: "text-sm leading-relaxed",
          },
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300",
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: "max-w-full h-auto rounded-lg shadow-md",
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
    const url = window.prompt("Enter URL", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt("Enter image URL");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 p-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
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
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("bulletList") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Bullet List (Ctrl+Shift+8)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
            editor.isActive("orderedList") ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
          }`}
          title="Numbered List (Ctrl+Shift+9)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm0 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm0 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
            <path d="M2 4a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 100 2 1 1 0 000-2z" />
          </svg>
        </button>
        <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-600 mx-1" />
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
        <button
          type="button"
          onClick={addImage}
          className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-600 dark:text-zinc-400"
          title="Add Image"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
      <div 
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
