// Gateable features. Mirrors public.features in the database; whether a
// room has one is decided server-side (get_room_entitlements).
export const FEATURES = {
  groups: {
    label: "Groups",
    description: "Split students into teams, houses or tables.",
  },
  points: {
    label: "Points",
    description: "Award and deduct points, with group and individual scoreboards.",
  },
  custom_media: {
    label: "Custom reveal media",
    description: "Play your own clip for each group when students are sorted.",
  },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
