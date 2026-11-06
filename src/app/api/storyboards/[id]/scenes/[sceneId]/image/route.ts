import { binary, json, viewerStage, withViewer } from "@/lib/api";
import { isWebpBytes } from "@/lib/image-validate";
import { IMAGE_UPLOAD_LIMIT, rejectIfBodyTooLarge } from "@/lib/request-limits";
import { getSceneImage, saveSceneImage } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string; sceneId: string }> };

const MAX_BYTES = 120 * 1024;

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

  return binary(ctx, image.bytes, image.mime);
}

export async function POST(request: Request, { params }: Params) {
  const tooLarge = rejectIfBodyTooLarge(request, IMAGE_UPLOAD_LIMIT);
  if (tooLarge) return tooLarge;

  const ctx = await withViewer(request);
  if (ctx instanceof Response) return ctx;
  const { id, sceneId } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return json(ctx, { error: "missing_image" }, { status: 400 });
  }
  if (file.type !== "image/webp") {
    return json(ctx, { error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return json(ctx, { error: "too_large" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES || !isWebpBytes(bytes)) {
    return json(ctx, { error: "invalid_image" }, { status: 400 });
  }

  try {
    const scene = await saveSceneImage(
      id,
      sceneId,
      ctx.viewer.sub,
      viewerStage(ctx.viewer),
      "image/webp",
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
