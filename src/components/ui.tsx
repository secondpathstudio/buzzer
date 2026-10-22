export function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="mt-3 text-neutral-500">{children}</div>}
    </main>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "go") {
  const base =
    "inline-flex items-center justify-center rounded-xl px-5 py-4 text-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";
  return {
    primary: `${base} bg-wine-500 text-white dark:bg-wine-400 dark:text-white`,
    secondary: `${base} border border-neutral-300 text-neutral-900 dark:border-neutral-700 dark:text-neutral-100`,
    go: `${base} bg-green-600 text-white`,
  }[variant];
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Message title="Couldn't load the room">
      Check your connection. This page will retry when you&apos;re back online.
      <div className="mt-6">
        <button onClick={onRetry} className={buttonClass("primary")}>
          Try again
        </button>
      </div>
    </Message>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-40 ${
        checked ? "bg-green-600" : "bg-neutral-300 dark:bg-neutral-700"
      }`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
