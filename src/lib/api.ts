import {
  resolveViewer,
  viewerStage,
  withViewerHeaders,
  type ViewerContext,
} from "@/lib/auth";

export async function withViewer(
  request: Request,
): Promise<ViewerContext | Response> {
  return resolveViewer(request);
}

export function json(
  _ctx: ViewerContext,
  body: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: withViewerHeaders(init),
  });
}

export function empty(_ctx: ViewerContext, status = 204): Response {
  return new Response(null, {
    status,
    headers: withViewerHeaders({ status }),
  });
}

export function binary(
  _ctx: ViewerContext,
  data: Buffer,
  contentType: string,
): Response {
  const headers = withViewerHeaders();
  headers.set("content-type", contentType);
  headers.set("content-length", String(data.byteLength));
  headers.set("x-content-type-options", "nosniff");
  // Copy into a fresh ArrayBuffer-backed Uint8Array for the Fetch BodyInit type.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Response(copy, { headers });
}

export { viewerStage };
