import { json, viewerStage, withViewer } from "@/lib/api";
import { readJsonBody } from "@/lib/request-limits";
import { createScene } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const parsed = await readJsonBody<{
    description?: string;
    durationSeconds?: number;
  }>(request);
  if (!parsed.ok) return parsed.response;

  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const scene = await createScene(
      id,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      parsed.body,
    );
    if (!scene) return json(ctx, { error: "not_found" }, { status: 404 });
    return json(ctx, { scene }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "limit_reached") {
      return json(ctx, { error: "limit_reached" }, { status: 429 });
    }
    throw error;
  }
}
