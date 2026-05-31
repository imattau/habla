import ClientOnly from "~/ui/client-only";
import { buildBaseSeoTags } from "~/seo";
import { useActiveAccount } from "applesauce-react/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/ui/card";
import AIDraftingSettingsPanel from "~/ui/ai-drafting-settings-panel";
import { AlertCircle } from "lucide-react";
import { Button } from "~/ui/button";
import { useNavigate } from "react-router";

export function meta() {
  return buildBaseSeoTags({
    title: "Settings",
    description: "Manage your settings",
    url: "https://habla.news/settings",
    type: "website",
  });
}

function SettingsContent() {
  const account = useActiveAccount();
  const navigate = useNavigate();

  if (!account) {
    return (
      <Card className="mx-auto mt-8 max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="size-4" />
            Sign in required
          </CardTitle>
          <CardDescription>
            AI draft settings are stored per account. Connect a Nostr account to
            configure a provider key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate("/")} variant="secondary">
            Go home
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Manage per-account preferences and AI drafting credentials.
        </p>
      </div>
      <AIDraftingSettingsPanel pubkey={account.pubkey} />
    </div>
  );
}

export default function Settings() {
  return <ClientOnly>{() => <SettingsContent />}</ClientOnly>;
}
