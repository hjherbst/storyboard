import { privateHeaders, requireViewer, viewerStage } from "@/lib/auth";
import { createStoryboard, listStoryboards } from "@/lib/storyboards";

export async function GET(request: Request) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;

  const boards = await listStoryboards(identity.sub, viewerStage(identity));
  return Response.json(
    { storyboards: boards, viewer: { name: identity.name } },
    { headers: privateHeaders },
  );
}

export async function POST(request: Request) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
  };
  const board = await createStoryboard(
    identity.sub,
    viewerStage(identity),
    body.title ?? "Neues Storyboard",
    body.summary ?? "",
  );
  return Response.json({ storyboard: board }, { status: 201, headers: privateHeaders });
}
