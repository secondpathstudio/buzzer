import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Color_Emoji } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// For devices without an emoji font (e.g. a Raspberry Pi TV), so emoji names
// aren't boxes. Only the pieces a page uses are downloaded, so no preload.
const notoEmoji = Noto_Color_Emoji({
  variable: "--font-emoji",
  weight: "400",
  subsets: ["emoji"],
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "BuzzFirst",
  description: "A real-time buzzer for live lectures",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoEmoji.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
