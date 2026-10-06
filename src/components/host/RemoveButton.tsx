export function RemoveButton({ name, onClick }: { name: string | undefined; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Remove ${name ?? "participant"}`}
      title="Remove from room"
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-60 hover:bg-red-600 hover:text-white hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
    >
      ×
    </button>
  );
}
