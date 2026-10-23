import type { MetadataRoute } from "next";

// Home-screen icons for Android; the tab icons come from favicon.ico, icon.png and apple-icon.png.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BuzzFirst",
    short_name: "BuzzFirst",
    description: "A real-time buzzer for live lectures",
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
