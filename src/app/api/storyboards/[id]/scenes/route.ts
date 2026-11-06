import { privateHeaders, requireViewer, viewerStage } from "@/lib/auth";
import { createScene } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    description?: string;
    durationSeconds?: number;
  };

  const scene = await createScene(id, identity.sub, viewerStage(identity), body);
  if (!scene) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return Response.json({ scene }, { status: 201, headers: privateHeaders });
}
