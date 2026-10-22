import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/landing/ContactForm";
import { buttonClass } from "@/components/ui";

const REPO_URL = "https://github.com/secondpathstudio/buzzer";

export const metadata: Metadata = {
  title: "BuzzFirst: a real-time buzzer for live classes",
  description:
    "Students scan a QR code and buzz in from their phones, no login needed. You see who was first. Free and open source.",
};

const steps = [
  { title: "Open a room", body: "One click gives you a room with a QR code and a short join code." },
  { title: "Students scan", body: "They join from any phone browser. No app, no account, no email." },
  { title: "Buzz in", body: "Open a round and see everyone ranked by who buzzed first." },
];

const features = [
  { emoji: "⚡", title: "Real-time ranking", body: "Every buzz shows up instantly, in order, on your screen and the big screen." },
  { emoji: "📱", title: "No login for students", body: "Scan and go. Works with a whole lecture hall on one campus wifi." },
  { emoji: "🏆", title: "Groups & points", body: "Sort students into teams at random or let them choose, then award points per round." },
  { emoji: "📺", title: "TV display", body: "Pair a classroom TV once and it shows your newest room automatically." },
  { emoji: "🖱️", title: "Clicker friendly", body: "Open, lock and reset rounds from the keyboard or a presentation clicker." },
  { emoji: "🔓", title: "Open source", body: "MIT licensed. Host your own copy for free on Supabase and Vercel." },
];

export default function Landing() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <span className="text-xl font-bold tracking-tight">BuzzFirst</span>
        <nav className="flex items-center gap-5 text-sm font-medium">
          <a href="#contact" className="text-neutral-500 hover:text-foreground">
            Contact
          </a>
          <a href={REPO_URL} className="text-neutral-500 hover:text-foreground">
            GitHub
          </a>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pt-16 pb-20 text-center sm:pt-24">
          <div className="mb-8 flex size-24 items-center justify-center rounded-full bg-red-600 text-4xl shadow-lg animate-buzz-pulse">
            <span aria-hidden="true">🔔</span>
          </div>
          <h1 className="max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
            Who buzzed first? Now you know.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-500 sm:text-xl">
            A real-time buzzer for live lectures and classrooms. Students scan a QR code and buzz in from their
            phones, with no app and no login.
          </p>
          <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href="/host" className={buttonClass("primary")}>
              Start a room
            </Link>
            <a href={REPO_URL} className={buttonClass("secondary")}>
              View on GitHub
            </a>
          </div>
        </section>

        <section className="border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-16 sm:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title}>
                <span className="font-mono text-sm text-neutral-500">0{i + 1}</span>
                <h2 className="mt-1 text-xl font-semibold">{step.title}</h2>
                <p className="mt-2 text-neutral-500">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight">Built for the room you teach in</h2>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <li key={f.title} className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
                <span aria-hidden="true" className="text-2xl">
                  {f.emoji}
                </span>
                <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
                <p className="mt-1 text-neutral-500">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="contact" className="scroll-mt-8 border-t border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto w-full max-w-2xl px-4 py-20">
            <h2 className="text-3xl font-bold tracking-tight">Get in touch</h2>
            <p className="mt-3 text-neutral-500">
              Questions about using BuzzFirst at your school, a hosted plan, or anything else? Send a note.
              For bugs and feature requests, please{" "}
              <a href={`${REPO_URL}/issues`} className="underline">
                open a GitHub issue
              </a>
              .
            </p>
            <div className="mt-8">
              {turnstileSiteKey ? (
                <ContactForm siteKey={turnstileSiteKey} />
              ) : (
                <a href={`${REPO_URL}/issues`} className={buttonClass("secondary")}>
                  Open a GitHub issue
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} BuzzFirst · MIT licensed</span>
          <a href={REPO_URL} className="hover:text-foreground">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
