"use client";

import { useEffect, useState } from "react";
import { Button } from "~/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/ui/card";
import { Input } from "~/ui/input";
import { Label } from "~/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/ui/select";
import {
  clearAIDraftingSettings,
  DEFAULT_MODELS,
  fetchAvailableModels,
  getDefaultAIDraftingSettings,
  loadAIDraftingSettings,
  PROVIDER_LABELS,
  saveAIDraftingSettings,
  hydrateAIDraftingSettings,
  testAIDraftingConnection,
  type AIProvider,
} from "~/services/ai-drafting";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";

interface AIDraftingSettingsPanelProps {
  pubkey: string;
}

export default function AIDraftingSettingsPanel({
  pubkey,
}: AIDraftingSettingsPanelProps) {
  const account = useActiveAccount();
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [status, setStatus] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);
  const [modelStatus, setModelStatus] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (account?.pubkey !== pubkey) {
        return;
      }

      try {
        await hydrateAIDraftingSettings(account, { force: true });
      } catch (error) {
        console.warn("[ai-drafting] Failed to hydrate settings:", error);
      }

      if (cancelled) return;
      const settings = loadAIDraftingSettings(pubkey);
      setProvider(settings.provider);
      setApiKey(settings.apiKey);
      setModel(settings.model);
      setStatus(null);
      setModelStatus(null);
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [account, pubkey]);

  async function loadModels() {
    const currentApiKey = apiKey.trim();
    if (!currentApiKey) {
      setModelStatus({
        kind: "error",
        message: "Add an API key before loading models.",
      });
      return;
    }

    setIsLoadingModels(true);
    try {
      const models = await fetchAvailableModels(provider, currentApiKey);
      const ids = models.map((model) => model.id);
      const next = Array.from(new Set([model.trim() || DEFAULT_MODELS[provider], ...ids])).sort();
      setAvailableModels(next);
      setModelStatus({
        kind: "success",
        message: `Loaded ${ids.length} model${ids.length === 1 ? "" : "s"} from ${PROVIDER_LABELS[provider]}.`,
      });
      toast.success("Models loaded");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load models.";
      console.error("[ai-drafting] Failed to load models:", error);
      setModelStatus({ kind: "error", message });
      toast.error("Failed to load models", { description: message });
    } finally {
      setIsLoadingModels(false);
    }
  }

  function applyProvider(nextProvider: AIProvider) {
    setProvider(nextProvider);
    setModel((current) => {
      if (!current || current === DEFAULT_MODELS[provider]) {
        return DEFAULT_MODELS[nextProvider];
      }
      return current;
    });
    setAvailableModels([]);
    setModelStatus(null);
  }

  async function save() {
    setIsSaving(true);
    try {
      if (!account) {
        throw new Error("Connect an account first");
      }

      await saveAIDraftingSettings(account, {
        provider,
        apiKey: apiKey.trim(),
        model: model.trim() || DEFAULT_MODELS[provider],
      });
      setStatus({ kind: "success", message: "AI draft settings saved." });
      toast.success("AI draft settings saved");
      void loadModels();
    } catch (error) {
      console.error("[ai-drafting] Failed to save settings:", error);
      setStatus({
        kind: "error",
        message: "Failed to save AI draft settings.",
      });
      toast.error("Failed to save AI draft settings");
    } finally {
      setIsSaving(false);
    }
  }

  async function test() {
    if (!apiKey.trim()) {
      setStatus({
        kind: "error",
        message: "Add an API key before testing the connection.",
      });
      return;
    }

    setIsTesting(true);
    try {
      await testAIDraftingConnection(provider, apiKey.trim(), model.trim() || DEFAULT_MODELS[provider]);
      setStatus({ kind: "success", message: "Connection test succeeded." });
      toast.success("AI provider connection succeeded");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed.";
      console.error("[ai-drafting] Connection test failed:", error);
      setStatus({ kind: "error", message });
      toast.error("AI provider connection failed", { description: message });
    } finally {
      setIsTesting(false);
    }
  }

  function clear() {
    if (!account) {
      toast.error("Connect an account first");
      return;
    }

    void (async () => {
      try {
        await clearAIDraftingSettings(account);
        const defaults = getDefaultAIDraftingSettings();
        setProvider(defaults.provider);
        setApiKey(defaults.apiKey);
        setModel(defaults.model);
        setAvailableModels([]);
        setModelStatus(null);
        setStatus({ kind: "success", message: "AI draft settings cleared." });
        toast.success("AI draft settings cleared");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to clear settings.";
        console.error("[ai-drafting] Failed to clear settings:", error);
        setStatus({ kind: "error", message });
        toast.error("Failed to clear AI draft settings", { description: message });
      }
    })();
  }

  const modelOptions = Array.from(
    new Set([
      model.trim() || DEFAULT_MODELS[provider],
      ...availableModels,
    ]),
  );

  return (
    <Card className="gap-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" />
          AI Drafting
        </CardTitle>
        <CardDescription>
          Store a provider key locally for this account. The editor uses it to
          generate article drafts directly from your browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="ai-provider">Provider</Label>
          <Select value={provider} onValueChange={(value) => applyProvider(value as AIProvider)}>
            <SelectTrigger id="ai-provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">{PROVIDER_LABELS.openai}</SelectItem>
              <SelectItem value="groq">{PROVIDER_LABELS.groq}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="ai-model">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="ai-model">
              <SelectValue placeholder={DEFAULT_MODELS[provider]} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((modelId) => (
                <SelectItem key={modelId} value={modelId}>
                  {modelId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODELS[provider]}
          />
          <p className="text-xs text-muted-foreground">
            Select a provider model, or type a custom model ID if you need one.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={loadModels}
            disabled={isLoadingModels || !apiKey.trim()}
          >
            <RefreshCw className={isLoadingModels ? "animate-spin" : ""} />
            {isLoadingModels ? "Loading models..." : "Load models"}
          </Button>
        </div>

        {modelStatus ? (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              modelStatus.kind === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {modelStatus.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{modelStatus.message}</span>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="ai-key">API key</Label>
          <Input
            id="ai-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Enter your ${PROVIDER_LABELS[provider]} API key`}
            autoComplete="off"
          />
        </div>

        {status ? (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              status.kind === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {status.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{status.message}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={isSaving || isTesting}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={test}
            disabled={isSaving || isTesting}
          >
            {isTesting ? "Testing..." : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={clear}
            disabled={isSaving || isTesting}
          >
            <Trash2 />
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
