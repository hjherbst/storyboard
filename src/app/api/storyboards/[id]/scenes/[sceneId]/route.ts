import { empty, json, viewerStage, withViewer } from "@/lib/api";
import { readJsonBody } from "@/lib/request-limits";
import {
  clearSceneImage,
  deleteScene,
  getStoryboardOwned,
  moveScene,
  updateScene,
} from "@/lib/storyboards";

type Params = { params: Promise<{ id: string; sceneId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const parsed = await readJsonBody<{
    description?: string;
    durationSeconds?: number;
    position?: number;
    move?: "up" | "down";
    clearImage?: boolean;
  }>(request);
  if (!parsed.ok) return parsed.response;

  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id, sceneId } = await params;
  const body = parsed.body;

  if (body.move === "up" || body.move === "down") {
    const board = await moveScene(
      id,
      sceneId,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      body.move,
    );
    if (!board) return json(ctx, { error: "not_found" }, { status: 404 });
    return json(ctx, { storyboard: board });
  }

  if (body.clearImage) {
    const scene = await clearSceneImage(
      id,
      sceneId,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
    );
    if (!scene) return json(ctx, { error: "not_found" }, { status: 404 });
    return json(ctx, { scene });
  }

  const scene = await updateScene(
    id,
    sceneId,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
    body,
  );
  if (!scene) return json(ctx, { error: "not_found" }, { status: 404 });
  const board = await getStoryboardOwned(
    id,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  return json(ctx, { scene, storyboard: board });
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id, sceneId } = await params;
  const ok = await deleteScene(
    id,
    sceneId,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  if (!ok) return json(ctx, { error: "not_found" }, { status: 404 });
  return empty(ctx);
}
