import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

import {
  addStyleProfile,
  deleteStyleProfile,
  getStyleProfiles,
  setActiveProfile,
  updateStyleProfile,
} from "./actions";
import {
  getLinkedInProfiles,
  addLinkedInProfile,
  startLinkedInProfileScrape,
  resyncLinkedInProfile,
  removeLinkedInProfile,
  generateStyleFingerprint,
  checkLinkedInScrapeStatus,
  fetchFromDatasetUrlAction,
} from "./profile-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Palette, Plus } from "lucide-react";
import LinkedInProfileList from "./linkedin-profile-list";
import StyleProfileCard from "./style-profile-card";

export default async function StylesPage() {
  const profiles = await getStyleProfiles();
  const linkedInProfiles = await getLinkedInProfiles();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Style Profiles</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Define how the AI should write your LinkedIn posts
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Add Profile Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Create Style Profile</CardTitle>
            <CardDescription>
              Describe your voice and tone in natural language
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={async (formData) => {
                "use server";
                await addStyleProfile(formData);
                revalidatePath("/styles");
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <label className="text-base font-medium">Profile Name</label>
                <Input name="name" placeholder="e.g., My Professional Voice" required />
              </div>

              <div className="space-y-2">
                <label className="text-base font-medium">Style Description</label>
                <Textarea
                  name="prompt_text"
                  placeholder="Short paragraphs, confident tone, 3-5 bullet points per post, emojis only when demonstrating, always end with a question to drive engagement..."
                  rows={8}
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_active"
                  id="is_active"
                  className="rounded border-gray-300 h-5 w-5"
                />
                <label htmlFor="is_active" className="text-base font-medium">
                  Set as active profile
                </label>
              </div>

              <Button type="submit" className="w-full text-base">
                <Plus className="h-5 w-5 mr-2" />
                Create Profile
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Profiles List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your Profiles</CardTitle>
            <CardDescription>
              {profiles.length} profile{profiles.length !== 1 ? "s" : ""} saved
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profiles.length === 0 ? (
              <p className="text-base text-muted-foreground">
                No style profiles yet. Create one to guide the AI&apos;s writing.
              </p>
            ) : (
              <div className="space-y-4">
                {profiles.map((profile) => (
                  <StyleProfileCard
                    key={profile.id}
                    profile={profile}
                    onSetActive={async () => {
                      "use server";
                      await setActiveProfile(profile.id);
                      revalidatePath("/styles");
                    }}
                    onDelete={async () => {
                      "use server";
                      await deleteStyleProfile(profile.id);
                      revalidatePath("/styles");
                    }}
                    onUpdate={async (name, promptText) => {
                      "use server";
                      await updateStyleProfile(profile.id, name, promptText);
                      revalidatePath("/styles");
                    }}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* LinkedIn Style Cloning */}
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">
            LinkedIn Style Cloning
          </h2>
          <p className="text-muted-foreground mt-1">
            Add LinkedIn profiles you admire. The AI will analyze their posts and
            create a style fingerprint you can use to write like them.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              LinkedIn Profiles
            </CardTitle>
            <CardDescription>
              {linkedInProfiles.length} profile
              {linkedInProfiles.length !== 1 ? "s" : ""} added
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LinkedInProfileList
              profiles={linkedInProfiles}
              onAdd={async (url) => {
                "use server";
                await addLinkedInProfile(url);
                revalidatePath("/styles");
              }}
              onStartScrape={async (id) => {
                "use server";
                await startLinkedInProfileScrape(id);
                revalidatePath("/styles");
              }}
              onResync={async (id) => {
                "use server";
                await resyncLinkedInProfile(id);
                revalidatePath("/styles");
              }}
              onRemove={async (id) => {
                "use server";
                await removeLinkedInProfile(id);
                revalidatePath("/styles");
              }}
              onGenerateFingerprint={async () => {
                "use server";
                await generateStyleFingerprint();
                revalidatePath("/styles");
              }}
              onCheckStatus={async (id) => {
                "use server";
                return await checkLinkedInScrapeStatus(id);
              }}
              onFetchFromDatasetUrl={async (id, url) => {
                "use server";
                await fetchFromDatasetUrlAction(id, url);
                revalidatePath("/styles");
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
