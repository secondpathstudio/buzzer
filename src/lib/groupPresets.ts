// Group presets. Only generic presets ship with the repo; hosts save their
// own (e.g. franchise house names) to this browser's localStorage, never
// to the server or the repo.

export type GroupDraft = {
  id?: string;
  name: string;
  color: string;
  emoji: string | null;
  /** Omitted = keep the group's current media (see save_groups). */
  reveal_media_id?: string | null;
};

export type GroupPreset = {
  name: string;
  noun?: string;
  nounPlural?: string;
  /** The message shown while students are sorted; null = the default. */
  sortingText?: string | null;
  /** reveal_media_id refers to the host's library; missing ones are skipped. */
  groups: Omit<GroupDraft, "id">[];
};

export const SHIPPED_PRESETS: GroupPreset[] = [
  {
    name: "2 Teams",
    groups: [
      { name: "Red", color: "#E53935", emoji: null },
      { name: "Blue", color: "#1E88E5", emoji: null },
    ],
  },
  {
    name: "4 Teams",
    groups: [
      { name: "Red", color: "#E53935", emoji: null },
      { name: "Yellow", color: "#FDD835", emoji: null },
      { name: "Blue", color: "#1E88E5", emoji: null },
      { name: "Green", color: "#43A047", emoji: null },
    ],
  },
];

/** Colours offered for new groups, in order. */
export const GROUP_PALETTE = [
  "#E53935", "#1E88E5", "#FDD835", "#43A047", "#8E24AA", "#FB8C00",
  "#00ACC1", "#D81B60", "#6D4C41", "#546E7A", "#7CB342", "#3949AB",
];

export const MIN_GROUPS = 2;
export const MAX_GROUPS = 12;

const STORAGE_KEY = "buzzer:group-presets";

export function readLocalPresets(): GroupPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saves (or replaces, by name) a preset in this browser. */
export function saveLocalPreset(preset: GroupPreset): GroupPreset[] {
  const presets = [...readLocalPresets().filter((p) => p.name !== preset.name), preset];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {}
  return presets;
}

export function deleteLocalPreset(name: string): GroupPreset[] {
  const presets = readLocalPresets().filter((p) => p.name !== name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {}
  return presets;
}
