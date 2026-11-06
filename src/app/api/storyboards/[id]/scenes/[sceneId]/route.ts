import { privateHeaders, requireViewer, viewerStage } from "@/lib/auth";
import {
  clearSceneImage,
  deleteScene,
  getStoryboardOwned,
  moveScene,
  updateScene,
} from "@/lib/storyboards";

type Params = { params: Promise<{ id: string; sceneId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id, sceneId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    description?: string;
    durationSeconds?: number;
    position?: number;
    move?: "up" | "down";
    clearImage?: boolean;
  };

  if (body.move === "up" || body.move === "down") {
    const board = await moveScene(
      id,
      sceneId,
      identity.sub,
      viewerStage(identity),
      body.move,
    );
    if (!board) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: privateHeaders },
      );
    }
    return Response.json({ storyboard: board }, { headers: privateHeaders });
  }

  if (body.clearImage) {
    const scene = await clearSceneImage(
      id,
      sceneId,
      identity.sub,
      viewerStage(identity),
    );
    if (!scene) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: privateHeaders },
      );
    }
    return Response.json({ scene }, { headers: privateHeaders });
  }

  const scene = await updateScene(
    id,
    sceneId,
    identity.sub,
    viewerStage(identity),
    body,
  );
  if (!scene) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  const board = await getStoryboardOwned(
    id,
    identity.sub,
    viewerStage(identity),
  );
  return Response.json({ scene, storyboard: board }, { headers: privateHeaders });
}

export async function DELETE(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id, sceneId } = await params;

  const ok = await deleteScene(
    id,
    sceneId,
    identity.sub,
    viewerStage(identity),
  );
  if (!ok) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return new Response(null, { status: 204, headers: privateHeaders });
}
