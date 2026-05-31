"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Sparkles } from "lucide-react";
import { renderToMarkdownWithSpacing } from "~/lib/markdown-serializer";
import type { AIDraftScope } from "~/services/ai-drafting";
import { cn } from "~/lib/utils";
import type { JSONContent } from "@tiptap/core";

interface EditorAIHandleProps {
  editor: Editor;
  onOpen: (scope: AIDraftScope) => void;
}

type HandleState = {
  top: number;
  left: number;
  scope: AIDraftScope;
} | null;

function scopeToMarkdown(editor: Editor, from: number, to: number): string {
  const slice = editor.state.doc.slice(from, to);
  const json = {
    type: "doc",
    content: slice.content.toJSON(),
  } as JSONContent;

  return renderToMarkdownWithSpacing(json).trim();
}

function buildScope(editor: Editor): AIDraftScope | null {
  const { selection } = editor.state;
  if (!selection.$from.parent.isTextblock) return null;

  const isSelection = !selection.empty;
  const anchor = selection.$from.start(selection.$from.depth);
  const from = isSelection ? selection.from : anchor;
  const to = isSelection ? selection.to : selection.$from.end(selection.$from.depth);
  const markdown = scopeToMarkdown(editor, from, to);
  if (!markdown) return null;

  const label = isSelection ? "Selection" : `${selection.$from.parent.type.name} section`;

  return {
    from,
    to,
    markdown,
    label,
    anchor,
  };
}

export default function EditorAIHandle({ editor, onOpen }: EditorAIHandleProps) {
  const [state, setState] = useState<HandleState>(null);
  const selection = useEditorState({
    editor,
    selector: (ctx) => ({
      from: ctx.editor.state.selection.from,
      to: ctx.editor.state.selection.to,
      empty: ctx.editor.state.selection.empty,
      isFocused: ctx.editor.isFocused,
      isEditable: ctx.editor.isEditable,
    }),
  });

  const update = useCallback(() => {
    if (!selection.isEditable || !selection.isFocused) {
      setState(null);
      return;
    }

    const scope = buildScope(editor);
    if (!scope) {
      setState(null);
      return;
    }

    try {
      const startPos = Math.min((scope.anchor ?? scope.from) + 1, editor.state.doc.content.size);
      const coords = editor.view.coordsAtPos(startPos);
      setState({
        top: coords.top,
        left: coords.left,
        scope,
      });
    } catch (error) {
      console.error("[editor-ai-handle] Failed to position AI handle:", error);
      setState(null);
    }
  }, [editor, selection.isEditable, selection.isFocused]);

  useEffect(() => {
    update();
  }, [update, selection.from, selection.to, selection.empty, selection.isFocused, selection.isEditable]);

  useEffect(() => {
    const onScroll = () => update();
    const onResize = () => update();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [update]);

  if (!state) return null;

  return (
    <button
      type="button"
      aria-label={`AI assist ${state.scope.label.toLowerCase()}`}
      title={`AI assist ${state.scope.label.toLowerCase()}`}
      className={cn(
        "fixed z-40 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-md",
        "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
      )}
      style={{
        left: `${Math.max(12, state.left - 32)}px`,
        top: `${Math.max(12, state.top - 8)}px`,
      }}
      onClick={() => onOpen(state.scope)}
    >
      <Sparkles className="size-4" />
    </button>
  );
}
