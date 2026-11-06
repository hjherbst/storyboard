import { json, viewerStage, withViewer } from "@/lib/api";
import { readJsonBody } from "@/lib/request-limits";
import { createStoryboard, listStoryboards } from "@/lib/storyboards";

export async function GET(request: Request) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;

  const boards = await listStoryboards(
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  return json(ctx, {
    storyboards: boards,
    viewer: { name: ctx.viewer.name },
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody<{ title?: string; summary?: string }>(
    request,
  );
  if (!parsed.ok) return parsed.response;

  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;

  try {
    const board = await createStoryboard(
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      parsed.body.title ?? "Neues Storyboard",
      parsed.body.summary ?? "",
    );
    return json(ctx, { storyboard: board }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "limit_reached") {
      return json(ctx, { error: "limit_reached" }, { status: 429 });
    }
    throw error;
  }
}
