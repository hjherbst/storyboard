/** WebP files start with RIFF....WEBP */
export function isWebpBytes(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
