import { getSettings, saveSettings } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
      <p className="text-muted-foreground text-lg">
        Configure automation, scheduling, and preferences
      </p>

      <form action={saveSettings} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Automation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Auto-sync RSS */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label htmlFor="autoSyncRss" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Auto-sync RSS feeds</label>
                <p className="text-sm text-muted-foreground">
                  Automatically fetch new articles every 2 days
                </p>
              </div>
              <input
                type="checkbox"
                id="autoSyncRss"
                name="autoSyncRss"
                defaultChecked={settings.autoSyncRss}
                className="h-5 w-5 rounded border-gray-300"
              />
            </div>

            {/* Auto-generate ideas */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="autoGenerateIdeas">Auto-generate ideas</label>
                <p className="text-sm text-muted-foreground">
                  Generate new ideas daily from recent articles
                </p>
              </div>
              <input
                type="checkbox"
                id="autoGenerateIdeas"
                name="autoGenerateIdeas"
                defaultChecked={settings.autoGenerateIdeas}
                className="h-5 w-5 rounded border-gray-300"
              />
            </div>

            {/* Auto-publish approved */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="autoPublishApproved">Auto-publish approved posts</label>
                <p className="text-sm text-muted-foreground">
                  Automatically queue approved posts for publishing
                </p>
              </div>
              <input
                type="checkbox"
                id="autoPublishApproved"
                name="autoPublishApproved"
                defaultChecked={settings.autoPublishApproved}
                className="h-5 w-5 rounded border-gray-300"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Timezone */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="timezone">Timezone</label>
              <Input
                id="timezone"
                name="timezone"
                type="text"
                defaultValue={settings.timezone}
                placeholder="e.g., Europe/Athens"
              />
              <p className="text-sm text-muted-foreground">
                IANA timezone name (e.g., Europe/Athens, America/New_York)
              </p>
            </div>

            {/* Preferred posting time */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="preferredPostingTime">Preferred posting time</label>
              <Input
                id="preferredPostingTime"
                name="preferredPostingTime"
                type="time"
                defaultValue={settings.preferredPostingTime}
              />
              <p className="text-sm text-muted-foreground">
                Time of day to publish queued posts (in your timezone)
              </p>
            </div>

            {/* Max posts per day */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="maxPostsPerDay">Max posts per day</label>
              <Input
                id="maxPostsPerDay"
                name="maxPostsPerDay"
                type="number"
                min={1}
                max={10}
                defaultValue={settings.maxPostsPerDay}
              />
              <p className="text-sm text-muted-foreground">
                Maximum LinkedIn posts per day (includes manual publishes)
              </p>
            </div>

            {/* Ideas per day */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="ideasPerDay">Ideas per day</label>
              <Input
                id="ideasPerDay"
                name="ideasPerDay"
                type="number"
                min={1}
                max={10}
                defaultValue={settings.ideasPerDay}
              />
              <p className="text-sm text-muted-foreground">
                How many new ideas to generate each day
              </p>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" size="lg">
          Save Settings
        </Button>
      </form>
    </div>
  );
}
