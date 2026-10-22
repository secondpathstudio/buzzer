"use client";

import Script from "next/script";
import { useEffect, useImperativeHandle, useRef, useState } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = { reset: () => void };

/** Cloudflare Turnstile. Calls onToken with each token, and "" when it lapses. */
export function Turnstile({
  siteKey,
  action,
  onToken,
  ref,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
  ref?: React.Ref<TurnstileHandle>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>(undefined);
  const [ready, setReady] = useState(false);
  // The widget keeps the first callback it's given, so read the latest one.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useImperativeHandle(ref, () => ({
    // Each token works once, so get a fresh one before any retry.
    reset() {
      onTokenRef.current("");
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!ready || !el.current || !window.turnstile) return;
    const id = window.turnstile.render(el.current, {
      sitekey: siteKey,
      action,
      callback: (token: string) => onTokenRef.current(token),
      "expired-callback": () => onTokenRef.current(""),
      "error-callback": () => onTokenRef.current(""),
    });
    widgetId.current = id;
    return () => window.turnstile?.remove(id);
  }, [ready, siteKey, action]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setReady(true)}
      />
      <div ref={el} className="flex min-h-[65px] justify-center" />
    </>
  );
}
