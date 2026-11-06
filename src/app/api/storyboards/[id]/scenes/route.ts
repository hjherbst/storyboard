import { json, viewerStage, withViewer } from "@/lib/api";
import { createScene } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    description?: string;
    durationSeconds?: number;
  };

  try {
    const scene = await createScene(
      id,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      body,
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
