"use server";

import { headers } from "next/headers";

export type ContactState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

const LIMITS = { name: 100, email: 254, organization: 150, message: 5000 };

// Best-effort per-IP limit. It lives in one server instance's memory, so it
// only slows down a flood; Turnstile is what actually stops bots.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    recent.set(ip, hits);
    return true;
  }
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 10_000) recent.clear();
  return false;
}

/** Trimmed text, or undefined if missing, too long, or has control characters. */
function field(formData: FormData, key: keyof typeof LIMITS, multiline = false) {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > LIMITS[key]) return undefined;
  const control = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/;
  return control.test(text) ? undefined : text;
}

async function verifyTurnstile(token: string, ip: string | undefined): Promise<boolean> {
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY!,
    response: token,
  });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as {
      success: boolean;
      action?: string;
      metadata?: { result_with_testing_key?: boolean };
    };
    // Cloudflare's test keys (for local dev) don't echo the action back.
    return data.success && (data.action === "contact" || data.metadata?.result_with_testing_key === true);
  } catch {
    return false;
  }
}

export async function sendContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const { RESEND_API_KEY, TURNSTILE_SECRET_KEY, CONTACT_TO_EMAIL } = process.env;
  if (!RESEND_API_KEY || !TURNSTILE_SECRET_KEY || !CONTACT_TO_EMAIL) {
    console.error("Contact form: RESEND_API_KEY, TURNSTILE_SECRET_KEY or CONTACT_TO_EMAIL is not set");
    return { status: "error", message: "The contact form isn't set up yet. Please open a GitHub issue instead." };
  }

  // Honeypot: people never see this field, so anything in it is a bot.
  // Pretend it worked so the bot doesn't learn to skip it.
  const trap = formData.get("website");
  if (typeof trap === "string" && trap !== "") return { status: "sent" };

  const name = field(formData, "name");
  const email = field(formData, "email");
  const organization = field(formData, "organization") ?? "";
  const message = field(formData, "message", true);
  if (!name) return { status: "error", message: "Please enter your name (up to 100 characters)." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Please enter a valid email address." };
  }
  if (!message || message.length < 10) {
    return { status: "error", message: "Please write a message of 10 to 5,000 characters." };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  if (rateLimited(ip ?? "unknown")) {
    return { status: "error", message: "Too many messages. Please try again in a few minutes." };
  }

  const token = formData.get("cf-turnstile-response");
  if (typeof token !== "string" || !token || !(await verifyTurnstile(token, ip))) {
    return { status: "error", message: "Couldn't verify you're human. Please try again." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || "BuzzFirst <onboarding@resend.dev>",
        to: CONTACT_TO_EMAIL,
        reply_to: email,
        subject: `BuzzFirst inquiry from ${name}`,
        // Plain text only, so nothing in the message can render as HTML.
        text: `Name: ${name}\nEmail: ${email}\nOrganization: ${organization || "—"}\n\n${message}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error("Contact form: send failed", err);
    return { status: "error", message: "Couldn't send your message. Please try again later." };
  }

  return { status: "sent" };
}
