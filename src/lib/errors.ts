// Maps error codes raised by the SQL functions to UI messages (PLAN.md §5).
export type BuzzerErrorCode =
  | "room_full"
  | "room_not_found"
  | "round_not_open"
  | "round_not_waiting"
  | "round_not_found"
  | "not_host"
  | "not_a_participant"
  | "not_authenticated"
  | "too_many_active_rooms"
  | "invalid_name";

type PgError = { message?: string; hint?: string | null } | null | undefined;

export function errorCode(error: PgError): BuzzerErrorCode | undefined {
  return error?.message as BuzzerErrorCode | undefined;
}

export function errorMessage(error: PgError): string {
  switch (errorCode(error)) {
    case "room_full": {
      const limit = error?.hint?.match(/\d+/)?.[0];
      return limit ? `This room is full (limit: ${limit}).` : "This room is full.";
    }
    case "room_not_found":
      return "Room not found or expired. Check the code.";
    case "round_not_open":
      return "Round closed.";
    case "round_not_waiting":
      return "That round has already been opened.";
    case "not_host":
      return "Only the host can do that.";
    case "not_a_participant":
      return "You're not in this room yet.";
    case "too_many_active_rooms":
      return "You already have 3 active rooms.";
    case "invalid_name":
      return "Name must be 1–40 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}
