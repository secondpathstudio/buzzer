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
  | "invalid_name"
  // Groups, points & reveal media (PLAN-groups-points.md §6, §8)
  | "feature_not_available"
  | "group_required"
  | "invalid_group"
  | "group_choice_closed"
  | "need_at_least_two_groups"
  | "invalid_group_count"
  | "invalid_group_name"
  | "invalid_group_color"
  | "invalid_group_emoji"
  | "invalid_group_noun"
  | "invalid_sorting_text"
  | "duplicate_group_name"
  | "invalid_mode"
  | "points_disabled"
  | "invalid_presets"
  | "invalid_target"
  | "invalid_delta"
  | "media_limit_reached"
  | "invalid_media"
  | "invalid_media_path"
  | "invalid_background_dim"
  | "media_not_uploaded"
  // TV screens
  | "invalid_pair_code"
  // Room templates
  | "template_not_found"
  | "invalid_template_name"
  | "duplicate_template_name"
  | "too_many_templates";

/** The room's group labels, for messages that mention them. */
export type GroupLabels = { group_noun: string; group_noun_plural: string };
const DEFAULT_LABELS: GroupLabels = { group_noun: "Group", group_noun_plural: "Groups" };

type PgError =
  | { message?: string; hint?: string | null; code?: string; status?: number; name?: string }
  | null
  | undefined;

export function errorCode(error: unknown): BuzzerErrorCode | undefined {
  return (error as PgError)?.message as BuzzerErrorCode | undefined;
}

// Supabase Auth's per-IP limit on anonymous sign-ins (README: Rate Limits).
export function isRateLimited(error: unknown): boolean {
  const e = error as PgError;
  return e?.code === "over_request_rate_limit" || e?.status === 429;
}

// The request never reached Supabase, or we gave up waiting (AbortError).
// Browsers word this differently: Chrome "Failed to fetch", Safari "Load
// failed", Firefox "NetworkError…".
export function isNetworkError(error: unknown): boolean {
  const e = error as PgError;
  return (
    e?.name === "AuthRetryableFetchError" ||
    /failed to fetch|load failed|networkerror|network request failed|aborterror/i.test(e?.message ?? "")
  );
}

export function errorMessage(err: unknown, labels: GroupLabels = DEFAULT_LABELS): string {
  const error = err as PgError;
  const noun = labels.group_noun.toLowerCase();
  const plural = labels.group_noun_plural.toLowerCase();
  if (isRateLimited(error)) {
    return "Too many people have joined from this network recently. Wait a minute and try again, or ask the host to raise the sign-in rate limit.";
  }
  if (isNetworkError(error)) {
    return "No connection. Check your wifi and try again.";
  }
  switch (errorCode(error)) {
    case "room_full": {
      const limit = error?.hint?.match(/\d+/)?.[0];
      return limit ? `This room is full (limit: ${limit}).` : "This room is full.";
    }
    case "room_not_found":
      return "Room not found or expired. Check the code.";
    case "round_not_open":
    case "round_not_found":
      return "Round closed.";
    case "round_not_waiting":
      return "That round has already been opened.";
    case "not_host":
      return "Only the host can do that.";
    case "not_a_participant":
      return "You're not in this room yet.";
    case "not_authenticated":
      return "Your session expired. Reload the page.";
    case "too_many_active_rooms":
      return "You already have an active room, maybe in another browser. Reload this page to see it, then start a new one from here to end it.";
    case "invalid_name":
      return "Name must be 1–40 characters.";
    case "feature_not_available":
      // With billing on, gated controls show <UpgradePrompt> before this is reachable.
      return "This feature isn't enabled on this server.";
    case "group_required":
      return `Pick a ${noun} to join.`;
    case "invalid_group":
      return `That ${noun} no longer exists. Pick another.`;
    case "group_choice_closed":
      return `You're already in a ${noun}.`;
    case "need_at_least_two_groups":
      return `Add at least two ${plural} first.`;
    case "invalid_group_count":
      return `Use between 2 and 12 ${plural}.`;
    case "invalid_group_name":
      return `Each ${noun} needs a name of 1–30 characters.`;
    case "duplicate_group_name":
      return `Two ${plural} have the same name.`;
    case "invalid_group_noun":
      return "Labels must be 1–20 characters.";
    case "invalid_sorting_text":
      return "The sorting message must be 80 characters or fewer.";
    case "points_disabled":
      return "Turn on Points in Room options first.";
    case "invalid_presets":
      return "Use 1–6 quick-award amounts, each non-zero and between −1000 and 1000.";
    case "media_limit_reached": {
      const limit = error?.hint?.match(/\d+/)?.[0];
      return `Your media library is full${limit ? ` (${limit} files)` : ""}. Delete one to upload more.`;
    }
    case "invalid_media":
      return "That file isn't in your library.";
    case "invalid_pair_code":
      return "That code doesn't match a TV waiting to pair. Check the code on the TV (it changes every 15 minutes).";
    case "template_not_found":
      return "That template no longer exists.";
    case "invalid_template_name":
      return "Template names must be 1–60 characters.";
    case "duplicate_template_name":
      return "You already have a template with that name.";
    case "too_many_templates":
      return "You have the maximum number of templates (50). Delete one to save another.";
    case "invalid_group_color":
    case "invalid_group_emoji":
    case "invalid_mode":
    case "invalid_target":
    case "invalid_delta":
    case "invalid_media_path":
    case "invalid_background_dim":
    case "media_not_uploaded":
      // Developer errors: the UI shouldn't be able to send these.
      console.error(error);
      return "Something went wrong. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
