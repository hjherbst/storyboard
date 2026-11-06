import { empty, json, viewerStage, withViewer } from "@/lib/api";
import { readJsonBody } from "@/lib/request-limits";
import {
  deleteStoryboard,
  getStoryboardOwned,
  updateStoryboard,
} from "@/lib/storyboards";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const board = await getStoryboardOwned(
    id,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  if (!board) return json(ctx, { error: "not_found" }, { status: 404 });
  return json(ctx, { storyboard: board });
}

export async function PATCH(request: Request, { params }: Params) {
  const parsed = await readJsonBody<{ title?: string; summary?: string }>(
    request,
  );
  if (!parsed.ok) return parsed.response;

  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const board = await updateStoryboard(
    id,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
    parsed.body,
  );
  if (!board) return json(ctx, { error: "not_found" }, { status: 404 });
  return json(ctx, { storyboard: board });
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const ok = await deleteStoryboard(
    id,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  if (!ok) return json(ctx, { error: "not_found" }, { status: 404 });
  return empty(ctx);
}
