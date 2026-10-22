"use server";

import { createHmac, randomUUID } from "node:crypto";
import { headers } from "next/headers";

const TICKET_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Verifies a Turnstile token and returns a ticket that lets `userId` create
 * one room (checked by create_room, see the room_tickets migration). The
 * ticket only works for that user, so the id needn't be proven here.
 */
export async function getRoomTicket(
  userId: string,
  turnstileToken: string,
): Promise<{ ticket: string } | { error: "captcha_required" | "captcha_unavailable" }> {
  // Errors are returned, not thrown: production builds hide thrown messages.
  const { TURNSTILE_SECRET_KEY, ROOM_TICKET_SECRET } = process.env;
  if (!TURNSTILE_SECRET_KEY || !ROOM_TICKET_SECRET) {
    console.error("Room tickets: TURNSTILE_SECRET_KEY or ROOM_TICKET_SECRET is not set");
    return { error: "captcha_unavailable" };
  }
  if (!UUID.test(userId) || !turnstileToken) return { error: "captcha_required" };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: turnstileToken });
  if (ip) body.set("remoteip", ip);
  let ok = false;
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
    ok = data.success && (data.action === "create_room" || data.metadata?.result_with_testing_key === true);
  } catch (err) {
    console.error("Room tickets: Turnstile verify failed", err);
  }
  if (!ok) return { error: "captcha_required" };

  const payload = `${userId}.${Math.floor(Date.now() / 1000) + TICKET_SECONDS}.${randomUUID()}`;
  return { ticket: `${payload}.${createHmac("sha256", ROOM_TICKET_SECRET).update(payload).digest("hex")}` };
}
