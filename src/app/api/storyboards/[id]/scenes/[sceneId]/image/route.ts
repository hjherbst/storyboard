import { binary, json, viewerStage, withViewer } from "@/lib/api";
import { getSceneImage, saveSceneImage } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string; sceneId: string }> };

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id, sceneId } = await params;

  const image = await getSceneImage(
    id,
    sceneId,
    ctx.viewer.sub,
    viewerStage(ctx.viewer),
  );
  if (!image) return json(ctx, { error: "not_found" }, { status: 404 });

  return binary(ctx, new Uint8Array(image.bytes), image.mime);
}

export async function POST(request: Request, { params }: Params) {
  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id, sceneId } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return json(ctx, { error: "missing_image" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return json(ctx, { error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return json(ctx, { error: "too_large" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const scene = await saveSceneImage(
      id,
      sceneId,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      file.type,
      bytes,
    );
    if (!scene) return json(ctx, { error: "not_found" }, { status: 404 });
    return json(ctx, { scene });
  } catch (error) {
    if (error instanceof Error && error.message === "limit_reached") {
      return json(ctx, { error: "limit_reached" }, { status: 429 });
    }
    throw error;
  }
}
