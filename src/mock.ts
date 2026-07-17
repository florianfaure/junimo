import type { Snapshot } from "./types";

/**
 * Snapshot mock realiste — utilise tant que le branchement backend (tache #7)
 * n'est pas en place. Les 3 jauges sont calibrees a 34 % / 61 % / 87 % pour
 * couvrir les 3 couleurs du degrade (vert / orange / rouge). Mode "official"
 * (#23) : percent + reset_at exacts, used_tokens/cap non exposes (null).
 */
export const mockSnapshot: Snapshot = {
  gauges: {
    block_5h: {
      used_tokens: null,
      cap: null,
      percent: 34,
      reset_at: "2026-07-09T21:00:00.000Z",
      source: "official",
      tokens_source: null,
    },
    weekly: {
      used_tokens: null,
      cap: null,
      percent: 61,
      reset_at: "2026-07-13T09:00:00.000Z",
      source: "official",
      tokens_source: null,
    },
    // Tâche #31 : jauge officielle enrichie des tokens estimés localement
    // (percent/reset_at restent officiels, used_tokens/cap viennent de
    // l'estimation, marqués tokens_source: "estimated").
    weekly_fable: {
      used_tokens: 51_200_000,
      cap: 160_000_000,
      percent: 87,
      reset_at: "2026-07-13T09:00:00.000Z",
      source: "official",
      tokens_source: "estimated",
    },
  },
  // Exemple de la forme "estimated" (repli local, si l'API officielle est
  // indisponible ou l'utilisateur non authentifie OAuth) :
  // block_5h: {
  //   used_tokens: 306_000,
  //   cap: 900_000,
  //   percent: 34,
  //   reset_at: "2026-07-09T21:00:00.000Z",
  //   source: "estimated",
  // },
  mcps: [
    { name: "filesystem", scope: "global", transport: "stdio" },
    { name: "figma", scope: "project", transport: "sse" },
    { name: "linear", scope: "global", transport: "http" },
  ],
  projects: [
    {
      name: "junimo",
      tokens_7d: 1_842_000,
      last_used: "2026-07-09T16:30:00.000Z",
      top_model: "fable-5",
      path: "/Users/you/junimo",
      has_git: true,
      first_seen: "2026-06-18T09:12:00.000Z",
    },
    {
      name: "storefront",
      tokens_7d: 623_000,
      last_used: "2026-07-09T11:00:00.000Z",
      top_model: "sonnet-5",
      path: "/Users/you/storefront",
      has_git: true,
      first_seen: "2026-05-02T08:30:00.000Z",
    },
    {
      name: "dotfiles",
      tokens_7d: 48_000,
      last_used: "2026-07-06T18:42:00.000Z",
      top_model: "haiku-4-5",
      path: null,
      has_git: false,
      first_seen: null,
    },
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
    estimated: false,
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
  // Conversations récentes (tâche #43) : une en cours (dernier événement
  // il y a moins de 5 minutes, seuil côté backend), deux terminées.
  chats: [
    {
      id: "sess-live",
      project: "junimo",
      status: "in_progress",
      started_at: "2026-07-09T18:20:00.000Z",
      last_used: "2026-07-09T18:41:00.000Z",
      tokens: 306_000,
      model: "fable-5",
    },
    {
      id: "sess-done-1",
      project: "storefront",
      status: "done",
      started_at: "2026-07-09T10:15:00.000Z",
      last_used: "2026-07-09T11:00:00.000Z",
      tokens: 210_000,
      model: "sonnet-5",
    },
    {
      id: "sess-done-2",
      project: "junimo",
      status: "done",
      started_at: "2026-07-08T14:00:00.000Z",
      last_used: "2026-07-08T15:32:00.000Z",
      tokens: 540_000,
      model: "fable-5",
    },
  ],
};
