"use client";

import { useConnectionStatus } from "@/hooks/useConnectionStatus";

/** Fixed banner shown while the browser is offline or realtime is down. */
export function ConnectionBanner() {
  const status = useConnectionStatus();
  if (status === "online") return null;

  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-sm font-semibold shadow-md ${
        status === "offline" ? "bg-wine-400 text-white" : "bg-apricot-600 text-coffee-500"
      }`}
    >
      {status === "offline"
        ? "You're offline. Check your wifi; this page will update when you reconnect."
        : "Reconnecting…"}
    </div>
  );
}
