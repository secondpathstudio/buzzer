/** Gap between two server timestamps, e.g. "+0.14s". Never uses client time. */
export function formatGap(from: string, to: string): string {
  const seconds = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return `+${seconds.toFixed(2)}s`;
}

export function joinUrl(code: string): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (typeof window === "undefined" ? "" : window.location.origin);
  return `${origin.replace(/\/$/, "")}/r/${code}`;
}
