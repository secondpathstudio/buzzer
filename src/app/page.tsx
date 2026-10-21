"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { errorMessage } from "@/lib/errors";
import { isProfane } from "@/lib/profanity";
import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/session";

type Room = Pick<Tables<"rooms">, "id" | "code" | "title" | "expires_at">;

export default function Home() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [rooms, setRooms] = useState<Room[]>([]);

  // Bumped when the host signs in or out, to reload their rooms.
  const [account, setAccount] = useState(0);

  // Rooms this host already has open, so they can get back to them.
  useEffect(() => {
    const supabase = getSupabase();
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) {
        setRooms([]);
        return;
      }
      const { data: active } = await supabase
        .from("rooms")
        .select("id, code, title, expires_at")
        .eq("host_id", uid)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      setRooms(active ?? []);
    })();
  }, [account]);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (isProfane(title)) {
      setError("That room name isn't allowed. Please choose a different one.");
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      await ensureSession();
      const { data, error } = await getSupabase().rpc("create_room", {
        p_title: title.trim() || undefined,
      });
      if (error) throw error;
      router.push(`/host/${data.code}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10 px-4 py-12">
      <header className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">Buzzer</h1>
        <p className="mt-3 text-lg text-neutral-500">
          A real-time buzzer for live lectures. Students scan a QR code and
          join, no login needed.
        </p>
      </header>

      <form onSubmit={createRoom} className="flex flex-col gap-3">
        <label htmlFor="title" className="text-sm font-medium text-neutral-500">
          Room name (optional)
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="e.g. BIOL 201 — Week 4"
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-lg outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          disabled={creating}
          className="mt-2 rounded-xl bg-neutral-900 px-6 py-5 text-xl font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {creating ? "Creating…" : "Create room"}
        </button>
        {error && (
          <p role="alert" className="text-center text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>

      {rooms.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-500">
            Your active rooms
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {rooms.map((room) => (
              <li key={room.id}>
                <Link
                  href={`/host/${room.code}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="truncate">{room.title ?? "Untitled room"}</span>
                  <span className="font-mono text-lg tracking-widest">{room.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AccountPanel onChange={() => setAccount((n) => n + 1)} />
    </main>
  );
}
