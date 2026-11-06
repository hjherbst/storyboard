import { privateHeaders, requireViewer, viewerStage } from "@/lib/auth";
import { getSceneImage, saveSceneImage } from "@/lib/storyboards";

type Params = { params: Promise<{ id: string; sceneId: string }> };

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id, sceneId } = await params;

  const image = await getSceneImage(
    id,
    sceneId,
    identity.sub,
    viewerStage(identity),
  );
  if (!image) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      ...privateHeaders,
      "content-type": image.mime,
      "content-length": String(image.bytes.length),
    },
  });
}

export async function POST(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id, sceneId } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "missing_image" },
      { status: 400, headers: privateHeaders },
    );
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: "unsupported_type" },
      { status: 400, headers: privateHeaders },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "too_large" },
      { status: 400, headers: privateHeaders },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const scene = await saveSceneImage(
    id,
    sceneId,
    identity.sub,
    viewerStage(identity),
    file.type,
    bytes,
  );
  if (!scene) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return Response.json({ scene }, { headers: privateHeaders });
}
