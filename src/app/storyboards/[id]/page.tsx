import { Suspense } from "react";
import { StoryboardEditor } from "@/components/StoryboardEditor";

async function EditorLoader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryboardEditor storyboardId={id} />;
}

export default function StoryboardPage({
  params,
}: PageProps<"/storyboards/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="page-shell">
          <p className="muted loading-line">Lade Storyboard…</p>
        </div>
      }
    >
      <EditorLoader params={params} />
    </Suspense>
  );
}
