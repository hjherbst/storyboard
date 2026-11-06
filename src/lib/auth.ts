import { getIdentity } from "../../cursor/identity.js";

export type AppViewer = {
  sub: string;
  stage: "production" | "preview";
  name: string;
  guest: boolean;
};

export type ViewerContext = {
  viewer: AppViewer;
  /** Raw guest id to set as cookie when a new anonymous session starts. */
  newGuestId?: string;
};

const GUEST_COOKIE = "sb_owner";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const privateHeaders = {
  "cache-control": "private, no-store",
} as const;

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

export async function resolveViewer(request: Request): Promise<ViewerContext> {
  const identity = await getIdentity(request);
  if (identity.verified) {
    return {
      viewer: {
        sub: identity.sub,
        stage: identity.stage === "preview" ? "preview" : "production",
        name: identity.name || "Viewer",
        guest: false,
      },
    };
  }

  const existing = readCookie(request, GUEST_COOKIE);
  if (existing && UUID_RE.test(existing)) {
    return {
      viewer: {
        sub: `guest:${existing}`,
        stage: "production",
        name: "Gast",
        guest: true,
      },
    };
  }

  const guestId = crypto.randomUUID();
  return {
    viewer: {
      sub: `guest:${guestId}`,
      stage: "production",
      name: "Gast",
      guest: true,
    },
    newGuestId: guestId,
  };
}

export function viewerStage(viewer: AppViewer): "production" | "preview" {
  return viewer.stage === "preview" ? "preview" : "production";
}

export function withViewerHeaders(
  init: ResponseInit | undefined,
  ctx: ViewerContext,
): Headers {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(privateHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (ctx.newGuestId) {
    headers.append(
      "set-cookie",
      `${GUEST_COOKIE}=${encodeURIComponent(ctx.newGuestId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
    );
  }
  return headers;
}

/** @deprecated Prefer resolveViewer + withViewerHeaders for public apps. */
export async function requireViewer(
  request: Request,
): Promise<AppViewer | Response> {
  const ctx = await resolveViewer(request);
  return ctx.viewer;
}
