import { requireIdentity } from "../../cursor/identity.js";

export type AppViewer = {
  sub: string;
  stage: "production" | "preview";
  name: string;
  guest: false;
};

export type ViewerContext = {
  viewer: AppViewer;
};

export const privateHeaders = {
  "cache-control": "private, no-store",
} as const;

export async function resolveViewer(
  request: Request,
): Promise<ViewerContext | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  return {
    viewer: {
      sub: identity.sub,
      stage: identity.stage === "preview" ? "preview" : "production",
      name: identity.name || "Viewer",
      guest: false,
    },
  };
}

export function viewerStage(viewer: AppViewer): "production" | "preview" {
  return viewer.stage === "preview" ? "preview" : "production";
}

export function withViewerHeaders(init?: ResponseInit): Headers {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(privateHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return headers;
}
