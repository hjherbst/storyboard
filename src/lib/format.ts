export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes === 0) return `${rem}s`;
  return `${minutes}:${String(rem).padStart(2, "0")}`;
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(date);
}
