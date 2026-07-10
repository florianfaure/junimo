import type { Snapshot } from "./types";

/**
 * Snapshot mock realiste — utilise tant que le branchement backend (tache #7)
 * n'est pas en place. Les 3 jauges sont calibrees a 34 % / 61 % / 87 % pour
 * couvrir les 3 couleurs du degrade (vert / orange / rouge).
 */
export const mockSnapshot: Snapshot = {
  gauges: {
    block_5h: {
      used_tokens: 306_000,
      cap: 900_000,
      percent: 34,
      reset_at: "2026-07-09T21:00:00.000Z",
    },
    weekly: {
      used_tokens: 2_562_000,
      cap: 4_200_000,
      percent: 61,
      reset_at: "2026-07-13T09:00:00.000Z",
    },
    weekly_fable: {
      used_tokens: 1_218_000,
      cap: 1_400_000,
      percent: 87,
      reset_at: "2026-07-13T09:00:00.000Z",
    },
  },
  mcps: [
    { name: "filesystem", scope: "global", transport: "stdio" },
    { name: "figma", scope: "project", transport: "sse" },
    { name: "linear", scope: "global", transport: "http" },
  ],
  projects: [
    { name: "junimo", tokens_7d: 1_842_000, last_used: "2026-07-09T16:30:00.000Z", top_model: "fable-5" },
    { name: "vente-unique", tokens_7d: 623_000, last_used: "2026-07-09T11:00:00.000Z", top_model: "sonnet-5" },
    { name: "dotfiles", tokens_7d: 48_000, last_used: "2026-07-06T18:42:00.000Z", top_model: "haiku-4-5" },
  ],
  account: {
    plan: "Max",
    tier: "20x",
    email: "florian@junimo.dev",
    org: "Florian (perso)",
    default_model: "Sonnet 4.5",
    cli_version: "2.1.4",
    today_messages: 128,
    today_tokens: 842_000,
  },
  meta: {
    generated_at: "2026-07-09T18:42:00.000Z",
    degraded: [],
    estimated: true,
  },
  // 14 jours se terminant à la date du snapshot (2026-07-09), avec un pic le
  // 30/06 (journée lourde -> barre orange) et quelques jours creux (week-ends).
  history: [
    { date: "2026-06-26", tokens: 420_000 },
    { date: "2026-06-27", tokens: 0 },
    { date: "2026-06-28", tokens: 85_000 },
    { date: "2026-06-29", tokens: 610_000 },
    { date: "2026-06-30", tokens: 1_240_000 },
    { date: "2026-07-01", tokens: 780_000 },
    { date: "2026-07-02", tokens: 540_000 },
    { date: "2026-07-03", tokens: 320_000 },
    { date: "2026-07-04", tokens: 0 },
    { date: "2026-07-05", tokens: 45_000 },
    { date: "2026-07-06", tokens: 690_000 },
    { date: "2026-07-07", tokens: 910_000 },
    { date: "2026-07-08", tokens: 730_000 },
    { date: "2026-07-09", tokens: 842_000 },
  ],
};
