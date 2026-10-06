"use client";

import { readableText } from "@/lib/color";

export type PickerGroup = { id: string; name: string; color: string; emoji: string | null };

/** Large coloured group buttons for choose mode. */
export function GroupPicker({
  groups,
  selected,
  onSelect,
  disabled,
  label,
}: {
  groups: PickerGroup[];
  selected?: string;
  onSelect: (groupId: string) => void;
  disabled?: boolean;
  /** e.g. "Pick your House" */
  label: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-3 text-sm font-medium text-neutral-500">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        {groups.map((g) => {
          const isSelected = g.id === selected;
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(g.id)}
              style={{ backgroundColor: g.color, color: readableText(g.color) }}
              className={`flex min-h-20 flex-col items-center justify-center rounded-2xl px-3 py-4 text-lg font-bold transition active:scale-95 disabled:opacity-50 ${
                selected && !isSelected ? "opacity-40" : ""
              } ${isSelected ? "ring-4 ring-neutral-900 ring-offset-2 dark:ring-white dark:ring-offset-neutral-950" : ""}`}
            >
              {g.emoji && <span className="text-3xl" aria-hidden>{g.emoji}</span>}
              <span className="break-words">{g.name}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
