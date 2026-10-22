"use client";

import Script from "next/script";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { type ContactState, sendContact } from "@/lib/contact";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const inputClass =
  "rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-lg outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100";

export function ContactForm({ siteKey }: { siteKey: string }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContact, { status: "idle" });
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>(undefined);
  const [scriptReady, setScriptReady] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!scriptReady || !widgetRef.current || !window.turnstile) return;
    const id = window.turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      action: "contact",
      callback: setToken,
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    widgetId.current = id;
    return () => window.turnstile?.remove(id);
  }, [scriptReady, siteKey]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    // Submit manually so a failed attempt doesn't clear what was typed.
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set("cf-turnstile-response", token);
    startTransition(() => action(data));
    // Each token works once, so start a fresh challenge for any retry.
    setToken("");
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-green-600/40 bg-green-600/10 p-6 text-center">
        <p className="text-lg font-semibold">Thanks, your message is on its way.</p>
        <p className="mt-1 text-neutral-500">We&apos;ll reply to the email you gave.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setScriptReady(true)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-500">Name</span>
          <input name="name" required maxLength={100} autoComplete="name" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-500">Email</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-500">School or organization (optional)</span>
        <input name="organization" maxLength={150} autoComplete="organization" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-neutral-500">Message</span>
        <textarea name="message" required minLength={10} maxLength={5000} rows={5} className={inputClass} />
      </label>
      {/* Honeypot: hidden from people and screen readers, filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div ref={widgetRef} className="min-h-[65px]" />
      <button type="submit" disabled={pending || !token} className={buttonClass("primary")}>
        {pending ? "Sending…" : "Send message"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-center text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
