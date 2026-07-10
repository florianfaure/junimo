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
};
