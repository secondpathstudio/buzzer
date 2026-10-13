"use client";

import { use } from "react";
import { Display } from "@/components/display/Display";
import { HostGate } from "@/components/HostGate";

export default function DisplayPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  return <HostGate code={code}>{(room) => <Display room={room} controls />}</HostGate>;
}
