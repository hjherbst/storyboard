import {
  resolveViewer,
  viewerStage,
  withViewerHeaders,
  type ViewerContext,
} from "@/lib/auth";

export async function withViewer(
  request: Request,
): Promise<ViewerContext> {
  return resolveViewer(request);
}

export function json(
  ctx: ViewerContext,
  body: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: withViewerHeaders(init, ctx),
  });
}

export function empty(
  ctx: ViewerContext,
  status = 204,
): Response {
  return new Response(null, {
    status,
    headers: withViewerHeaders({ status }, ctx),
  });
}

export function binary(
  ctx: ViewerContext,
  data: Uint8Array,
  contentType: string,
): Response {
  const headers = withViewerHeaders({}, ctx);
  headers.set("content-type", contentType);
  headers.set("content-length", String(data.byteLength));
  return new Response(data, { headers });
}

export { viewerStage };
