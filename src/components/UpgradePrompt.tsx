import { BILLING_ENABLED, FEATURES, type FeatureKey } from "@/lib/features";

/**
 * Shown in place of a gated control. Placeholder only: no links or
 * checkout. Self-hosted servers (billing off) just say it isn't enabled.
 */
export function UpgradePrompt({ feature }: { feature: FeatureKey }) {
  return (
    <p className="flex items-center gap-2 text-sm text-neutral-500">
      <span aria-hidden>🔒</span>
      <span>
        {FEATURES[feature].label}:{" "}
        {BILLING_ENABLED ? "Available on paid plans" : "Not enabled on this server"}
      </span>
    </p>
  );
}
