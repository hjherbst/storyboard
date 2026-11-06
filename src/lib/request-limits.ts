/** Reject oversized request bodies before buffering them into memory. */
export function rejectIfBodyTooLarge(
  request: Request,
  maxBytes: number,
): Response | null {
  const raw = request.headers.get("content-length");
  if (raw == null || raw === "") {
    return Response.json(
      { error: "content_length_required" },
      {
        status: 411,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) {
    return Response.json(
      { error: "invalid_content_length" },
      {
        status: 400,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
  if (length > maxBytes) {
    return Response.json(
      { error: "too_large" },
      {
        status: 413,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
  return null;
}

export const JSON_BODY_LIMIT = 32 * 1024;
/** Multipart overhead above the 120 KB WebP payload. */
export const IMAGE_UPLOAD_LIMIT = 160 * 1024;

export async function readJsonBody<T extends Record<string, unknown>>(
  request: Request,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  const limited = rejectIfBodyTooLarge(request, JSON_BODY_LIMIT);
  if (limited) return { ok: false, response: limited };
  const body = (await request.json().catch(() => ({}))) as T;
  return { ok: true, body };
}
