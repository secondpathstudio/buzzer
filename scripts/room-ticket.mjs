// Signs a create_room ticket the way src/lib/roomTicket.ts does, so tests can
// create rooms without solving a captcha. Needs ROOM_TICKET_SECRET in
// .env.local when the room_ticket_secret Vault secret is set.
import { createHmac, randomUUID } from "node:crypto";

export async function roomTicket(client) {
  const secret = process.env.ROOM_TICKET_SECRET;
  if (!secret) return undefined;
  const { data } = await client.auth.getUser();
  const payload = `${data.user.id}.${Math.floor(Date.now() / 1000) + 300}.${randomUUID()}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
