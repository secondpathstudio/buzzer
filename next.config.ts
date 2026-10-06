import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Let phones on the same wifi use the dev server via this machine's LAN IP
// (and NEXT_PUBLIC_SITE_URL's host). Without this, Next blocks dev assets for
// non-localhost origins and the page hangs (e.g. stuck on "Creating…").
function devOrigins(): string[] {
  const hosts = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  try {
    hosts.push(new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname);
  } catch {}
  return [...new Set(hosts)];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
};

export default nextConfig;
