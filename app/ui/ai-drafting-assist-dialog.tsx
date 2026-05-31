"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, Settings2 } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "~/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/ui/dialog";
import { Input } from "~/ui/input";
import { Label } from "~/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/ui/select";
import { Textarea } from "~/ui/textarea";
import {
  type AIDraftAction,
  type AIDraftScope,
  type AIDraftingAccount,
  hydrateAIDraftingSettings,
  generateAIDraft,
  loadAIDraftingSettings,
  PROVIDER_LABELS,
  type AIProvider,
} from "~/services/ai-drafting";
import { renderToMarkdownWithSpacing } from "~/lib/markdown-serializer";
import { toast } from "sonner";
import { useActiveAccount } from "applesauce-react/hooks";

type DraftMode = "new" | "improve";

interface AIDraftingAssistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor;
  scope?: AIDraftScope | null;
  onApplyMarkdown: (
    markdown: string,
    scope?: AIDraftScope | null,
  ) => Promise<void> | void;
}

const ACTION_LABELS: Record<AIDraftAction, string> = {
  draft: "Draft new article",
  rewrite: "Rewrite selection",
  concise: "Make concise",
  expand: "Expand section",
  summary: "Summarize article",
};

function defaultSectionPrompt(action: AIDraftAction): string {
  switch (action) {
    case "concise":
      return "Make this section more concise while preserving the meaning.";
    case "expand":
      return "Expand this section with useful detail and clearer transitions.";
    case "rewrite":
    default:
      return "Rewrite this section for clarity and flow.";
  }
}

export default function AIDraftingAssistDialog({
  open,
  onOpenChange,
  editor,
  scope,
  onApplyMarkdown,
}: AIDraftingAssistDialogProps) {
  const account = useActiveAccount();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"new" | "improve">("new");
  const [action, setAction] = useState<AIDraftAction>("draft");
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generateTags, setGenerateTags] = useState(false);
  const [tagCount, setTagCount] = useState("5");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const activeAccount = account as AIDraftingAccount | undefined;
    if (!open || !activeAccount?.pubkey) return;
    const settingsAccount = activeAccount;

    let cancelled = false;
    async function loadSettings() {
      try {
        await hydrateAIDraftingSettings(settingsAccount, { force: true });
      } catch (error) {
        console.warn("[ai-drafting] Failed to hydrate settings:", error);
      }

      if (cancelled) return;
      const settings = loadAIDraftingSettings(settingsAccount.pubkey);
      setProvider(settings.provider);
      setModel(settings.model);
      setAction(scope ? "rewrite" : "draft");
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [account?.pubkey, open]);

  useEffect(() => {
    if (!open) return;
    setAction(scope ? "rewrite" : "draft");
  }, [open, scope]);

  async function generate() {
    const activeAccount = account as AIDraftingAccount | undefined;
    if (!activeAccount?.pubkey) {
      toast.error("Connect an account first");
      return;
    }
    const settingsAccount = activeAccount;

    await hydrateAIDraftingSettings(settingsAccount, { force: true });
    const settings = loadAIDraftingSettings(settingsAccount.pubkey);
    if (!settings.apiKey.trim()) {
      toast.error("Add an AI API key in Settings first");
      navigate("/settings");
      return;
    }

    if (!prompt.trim()) {
      if (!scope) {
        toast.error("Add a prompt for the draft");
        return;
      }
    }

    setIsGenerating(true);
    try {
      const effectiveAction: AIDraftAction = scope
        ? action
        : mode === "improve"
          ? "rewrite"
          : "draft";
      const currentMarkdown = scope
        ? scope.markdown
        : mode === "improve"
          ? renderToMarkdownWithSpacing(editor.getJSON())
          : undefined;
      const userPrompt = scope
        ? prompt.trim() || defaultSectionPrompt(effectiveAction)
        : prompt.trim();
      const result = await generateAIDraft({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: model.trim() || settings.model,
        action: effectiveAction,
        sectionScoped: Boolean(scope),
        generateTags: !scope && generateTags,
        tagCount: Number(tagCount) || 5,
        prompt: userPrompt,
        currentMarkdown,
        includeCurrentDraft: Boolean(scope) || mode === "improve",
      });

      await onApplyMarkdown(result.markdown, scope);
      toast.success("Draft generated");
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to generate draft";
      console.error("[ai-drafting] Draft generation failed:", error);
      toast.error("Failed to generate draft", { description: message });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            AI Draft Assist
          </DialogTitle>
          <DialogDescription>
            Generate or improve an article draft directly in the editor using
            your saved provider key.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {scope ? (
            <>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="mb-1 font-medium">Target section</div>
                <p className="text-muted-foreground">{scope.label}</p>
                <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-muted-foreground">
                  {scope.markdown}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ai-action">Action</Label>
                <Select value={action} onValueChange={(value) => setAction(value as AIDraftAction)}>
                  <SelectTrigger id="ai-action">
                    <SelectValue placeholder="Choose an action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rewrite">
                      {ACTION_LABELS.rewrite}
                    </SelectItem>
                    <SelectItem value="concise">
                      {ACTION_LABELS.concise}
                    </SelectItem>
                    <SelectItem value="expand">
                      {ACTION_LABELS.expand}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="ai-mode">Mode</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as "new" | "improve")}
              >
                <SelectTrigger id="ai-mode">
                  <SelectValue placeholder="Choose a mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Draft from prompt</SelectItem>
                  <SelectItem value="improve">Improve current draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="ai-provider">Provider</Label>
            <Input
              id="ai-provider"
              value={PROVIDER_LABELS[provider]}
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              Provider and key come from your AI settings.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Leave blank to use the saved default"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-prompt">Prompt</Label>
            <Textarea
              id="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder={
                mode === "improve"
                  ? "Rewrite this article for clarity, add a stronger opening, and tighten the structure."
                  : "Write an article about..."
              }
            />
          </div>

          {!scope && (
            <div className="rounded-md border bg-muted/30 px-3 py-3">
              <div className="flex items-start gap-3">
                <input
                  id="ai-generate-tags"
                  type="checkbox"
                  checked={generateTags}
                  onChange={(e) => setGenerateTags(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <div className="flex-1 space-y-3">
                  <div>
                    <Label
                      htmlFor="ai-generate-tags"
                      className="text-sm font-medium"
                    >
                      Generate tags
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Append relevant hashtags to the end of the generated
                      article.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:max-w-40">
                    <Label htmlFor="ai-tag-count" className="text-xs">
                      Hashtags
                    </Label>
                    <Select
                      value={tagCount}
                      onValueChange={setTagCount}
                      disabled={!generateTags}
                    >
                      <SelectTrigger id="ai-tag-count">
                        <SelectValue placeholder="Count" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, index) => String(index + 1)).map(
                          (count) => (
                            <SelectItem key={count} value={count}>
                              {count}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {scope
              ? "The selected section will be replaced in place."
              : mode === "improve"
              ? generateTags
                ? `The current editor content will be included as context, and ${tagCount} hashtag${tagCount === "1" ? "" : "s"} will be appended.`
                : "The current editor content will be included as context."
              : generateTags
              ? `The current draft will be used as a light style reference only, and ${tagCount} hashtag${tagCount === "1" ? "" : "s"} will be appended.`
              : "The current draft will be used as a light style reference only."}
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/settings")}
          >
            <Settings2 />
            Manage settings
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button type="button" onClick={generate} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Generate draft"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
