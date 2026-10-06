import { readableText } from "@/lib/color";

type ChipGroup = { name: string; color: string; emoji: string | null };

/** A pill in the group's colour. Size via className (text-sm, text-[4vh]…). */
export function GroupChip({
  group,
  className = "text-sm",
  children,
}: {
  group: ChipGroup;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-[0.35em] truncate rounded-full px-[0.75em] py-[0.2em] font-semibold ${className}`}
      style={{ backgroundColor: group.color, color: readableText(group.color) }}
    >
      {group.emoji && <span aria-hidden>{group.emoji}</span>}
      <span className="truncate">{group.name}</span>
      {children}
    </span>
  );
}
