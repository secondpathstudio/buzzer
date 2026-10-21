"use client";

import { useEffect, useState } from "react";
import {
  accountErrorMessage,
  confirmCode,
  currentEmail,
  hasAnonymousData,
  signOut,
  startLinkEmail,
  startSignIn,
} from "@/lib/supabase/account";

type Mode = "link" | "signin";
type Step =
  | { name: "idle" }
  | { name: "email"; mode: Mode }
  | { name: "code"; mode: Mode; email: string };

const inputClass =
  "rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-lg outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100";
const primaryButton =
  "rounded-xl bg-neutral-900 px-5 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-neutral-900";
const linkButton = "font-medium underline underline-offset-2";

/**
 * Lets a host add an email to their (anonymous) account, sign in to it on
 * another computer, or sign out. onChange runs after the user changes.
 */
export function AccountPanel({ onChange }: { onChange: () => void }) {
  // undefined = loading
  const [email, setEmail] = useState<string | null>();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [leavesData, setLeavesData] = useState(false);

  useEffect(() => {
    void currentEmail().then(setEmail);
  }, []);

  function go(next: Step) {
    setStep(next);
    setInput("");
    setError(undefined);
    if (next.name === "email" && next.mode === "signin") {
      void hasAnonymousData().then(setLeavesData);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submitEmail(e: React.FormEvent, mode: Mode) {
    e.preventDefault();
    const address = input.trim();
    void run(async () => {
      await (mode === "link" ? startLinkEmail(address) : startSignIn(address));
      go({ name: "code", mode, email: address });
    });
  }

  function submitCode(e: React.FormEvent, mode: Mode, address: string) {
    e.preventDefault();
    void run(async () => {
      await confirmCode(mode, address, input.trim());
      setEmail(await currentEmail());
      go({ name: "idle" });
      onChange();
    });
  }

  function resend(mode: Mode, address: string) {
    void run(() => (mode === "link" ? startLinkEmail(address) : startSignIn(address)));
  }

  if (email === undefined) return null;

  if (email) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
        <span>
          Signed in as <span className="font-medium text-neutral-900 dark:text-neutral-100">{email}</span>
        </span>
        <button
          className={linkButton}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await signOut();
              setEmail(null);
              onChange();
            })
          }
        >
          Sign out
        </button>
        {error && <p role="alert" className="w-full text-red-600 dark:text-red-400">{error}</p>}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      {step.name === "idle" && (
        <>
          <p className="text-neutral-500">
            Add your email to keep your clips and setups, and use them on other computers.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button className={linkButton} onClick={() => go({ name: "email", mode: "link" })}>
              Add email
            </button>
            <button className={linkButton} onClick={() => go({ name: "email", mode: "signin" })}>
              I already have an account
            </button>
          </div>
        </>
      )}

      {step.name === "email" && (
        <form onSubmit={(e) => submitEmail(e, step.mode)} className="flex flex-col gap-3">
          <label htmlFor="account-email" className="font-medium text-neutral-500">
            {step.mode === "link" ? "Your email" : "Sign in with your email"}
          </label>
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={inputClass}
          />
          {step.mode === "signin" && leavesData && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
              This browser has rooms or clips that aren&apos;t saved to an email. Signing in
              switches to your account, and they&apos;ll stay behind. To keep them, choose
              “Add email” instead.
            </p>
          )}
          <div className="flex items-center gap-4">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button type="button" className={linkButton} onClick={() => go({ name: "idle" })}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step.name === "code" && (
        <form
          onSubmit={(e) => submitCode(e, step.mode, step.email)}
          className="flex flex-col gap-3"
        >
          <label htmlFor="account-code" className="font-medium text-neutral-500">
            Enter the code we sent to {step.email}
          </label>
          <input
            id="account-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            required
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} font-mono tracking-widest`}
          />
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? "Checking…" : step.mode === "link" ? "Save email" : "Sign in"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={linkButton}
              onClick={() => resend(step.mode, step.email)}
            >
              Send a new code
            </button>
            <button type="button" className={linkButton} onClick={() => go({ name: "idle" })}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
