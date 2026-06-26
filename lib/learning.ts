import { OverrideFeature, OverrideLogEntry } from "./types";
import { getLearningLogRaw, setLearningLogRaw } from "./persistence";

const MAX_LOG_ENTRIES = 200;

// Not real ML — a frequency tally of past manual overrides, used to nudge
// future auto-picks toward whatever the user has been choosing this session.
export function logOverride(feature: OverrideFeature, chosen: string, auto: string): void {
  if (chosen === auto) return;
  const log = getLearningLogRaw() as OverrideLogEntry[];
  log.push({ feature, chosen, auto, ts: Date.now() });
  while (log.length > MAX_LOG_ENTRIES) log.shift();
  setLearningLogRaw(log);
}

// Frequency tally of "chosen" values previously logged for a feature —
// callers use this to bias auto-pick scoring toward repeat choices.
export function getSessionBias(feature: OverrideFeature): Map<string, number> {
  const log = getLearningLogRaw() as OverrideLogEntry[];
  const tally = new Map<string, number>();
  for (const entry of log) {
    if (entry.feature !== feature) continue;
    tally.set(entry.chosen, (tally.get(entry.chosen) ?? 0) + 1);
  }
  return tally;
}
