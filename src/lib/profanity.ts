import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";

// Client-side courtesy check on names and room titles when they're created.
// A determined user can bypass it by calling the RPC directly; the host can
// still remove them.
//
// The default English set matches inside words, which catches compounds
// ("fuckface") but also flags real surnames. These substrings are allowed so
// real names get through. Add to it when a real name is blocked; each entry
// is lowercase and lets that exact substring through anywhere.
const ALLOWED = [
  "anali", // Analia, Analise, Analisa
  "annali", // Annalise
  "cumming", // Cumming, Cummings
  "dickinson",
  "dikshit",
  "fagan",
  "faggiano",
  "fuku", // Fukuda, Fukushima, Fukuyama
  "hardick",
  "pussycat",
  "shital", // Shital, Sheetal
  "sheetal",
  "shitole",
  "shittu",
  "twatt",
  "wankhede",
];

const dataset = englishDataset.build();
const matcher = new RegExpMatcher({
  ...dataset,
  whitelistedTerms: [...(dataset.whitelistedTerms ?? []), ...ALLOWED],
  ...englishRecommendedTransformers,
});

export function isProfane(text: string): boolean {
  return matcher.hasMatch(text);
}
