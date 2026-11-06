import { privateHeaders, requireViewer, viewerStage } from "@/lib/auth";
import {
  deleteStoryboard,
  getStoryboardOwned,
  updateStoryboard,
} from "@/lib/storyboards";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id } = await params;

  const board = await getStoryboardOwned(
    id,
    identity.sub,
    viewerStage(identity),
  );
  if (!board) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return Response.json({ storyboard: board }, { headers: privateHeaders });
}

export async function PATCH(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
  };

  const board = await updateStoryboard(
    id,
    identity.sub,
    viewerStage(identity),
    body,
  );
  if (!board) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return Response.json({ storyboard: board }, { headers: privateHeaders });
}

export async function DELETE(request: Request, { params }: Params) {
  const identity = await requireViewer(request);
  if (identity instanceof Response) return identity;
  const { id } = await params;

  const ok = await deleteStoryboard(id, identity.sub, viewerStage(identity));
  if (!ok) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: privateHeaders },
    );
  }
  return new Response(null, { status: 204, headers: privateHeaders });
}
