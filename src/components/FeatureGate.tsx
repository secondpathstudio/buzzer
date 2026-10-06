"use client";

import { useEntitlements } from "@/hooks/useRoomEntitlements";
import type { FeatureKey } from "@/lib/features";

/**
 * Renders children if the room has the feature, otherwise the fallback.
 * Renders nothing while entitlements load. The database enforces the gate
 * too; this only decides what to show.
 */
export function FeatureGate({
  feature,
  fallback = null,
  children,
}: {
  feature: FeatureKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { has, loading } = useEntitlements();
  if (loading) return null;
  return <>{has(feature) ? children : fallback}</>;
}
