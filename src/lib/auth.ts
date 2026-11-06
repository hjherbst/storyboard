import { requireIdentity } from "../../cursor/identity.js";

export type AppIdentity = {
  verified: true;
  sub: string;
  stage: "production" | "preview";
  name: string;
  email: string;
  kind: "person" | "key";
};

export async function requireViewer(
  request: Request,
): Promise<AppIdentity | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  return identity as AppIdentity;
}

export function viewerStage(identity: AppIdentity): "production" | "preview" {
  return identity.stage === "preview" ? "preview" : "production";
}

export const privateHeaders = {
  "cache-control": "private, no-store",
} as const;
