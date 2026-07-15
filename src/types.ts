/**
 * Snapshot — contrat de donnees partage avec le backend Tauri (src-tauri/collector).
 * Le front est un pur affichage : aucune logique metier ici, uniquement des types.
 */

import type { JunimoAccessoryId, JunimoColorId, JunimoShapeId } from "./junimo/model";

export type GaugeSource = "official" | "estimated";

export interface Gauge {
  /** Tokens consommes sur la fenetre (input + output + cache_creation + cache_read). null en mode officiel (l'API de compte n'expose pas les tokens). */
  used_tokens: number | null;
  /** Plafond estime pour cette fenetre (constante calibrable selon le plan). null en mode officiel. */
  cap: number | null;
  /** used_tokens / cap * 100 en mode estime, ou pourcentage officiel du compte en mode officiel. Arrondi cote backend. */
  percent: number;
  /** Horodatage ISO 8601 du prochain reset de la fenetre. null = aucune session en cours (bloc 5h) ou reset inconnu. */
  reset_at: string | null;
  /** Origine de la donnee : "official" (API du compte, % + reset exacts) ou "estimated" (repli local, tokens + caps). */
  source: GaugeSource;
}

export interface Gauges {
  /** Bloc glissant de 5h (fenetre courante). */
  block_5h: Gauge;
  /** Fenetre glissante de 7 jours, tous modeles confondus. */
  weekly: Gauge;
  /** Fenetre glissante de 7 jours, famille de modele Fable/Opus. */
  weekly_fable: Gauge;
}

export type McpScope = "global" | "project";
export type McpTransport = "stdio" | "http" | "sse";

export interface McpServer {
  name: string;
  scope: McpScope;
  transport: McpTransport;
}

/**
 * État de santé d'un serveur MCP (tâche #17), renvoyé par la commande
 * `check_mcps` déclenchée manuellement. Aligné sur `McpHealth` côté Rust.
 */
export interface McpHealth {
  name: string;
  status: "ok" | "warn" | "down";
  detail: string | null;
}

export interface ProjectStat {
  /** Nom lisible du projet (dernier segment du dossier encodé, "?" si inconnu). */
  name: string;
  /** Tokens pondérés consommés sur la fenêtre 7 jours. */
  tokens_7d: number;
  /** Horodatage ISO 8601 du dernier usage, ou null si aucun. */
  last_used: string | null;
  /** Modèle dominant (préfixe claude- retiré côté backend). */
  top_model: string;
}

export interface DayUsage {
  /** Jour local (machine) au format YYYY-MM-DD. */
  date: string;
  /** Tokens pondérés consommés ce jour-là. */
  tokens: number;
}

export interface Account {
  plan: string;
  tier: string;
  email: string;
  org: string;
  default_model: string;
  cli_version: string;
  today_messages: number;
  today_tokens: number;
}

export interface Meta {
  /** Horodatage ISO 8601 de generation du snapshot. */
  generated_at: string;
  /** Cles des sources en echec ("gauges" | "mcps" | "account"), section degradee cote UI. */
  degraded: string[];
  /** true si les jauges sont en repli estimation locale (pas les vrais quotas Anthropic) ; false en mode officiel. */
  estimated: boolean;
}

export interface Snapshot {
  gauges: Gauges;
  mcps: McpServer[];
  projects: ProjectStat[];
  account: Account;
  meta: Meta;
  /** Consommation quotidienne sur 14 jours (section « Historique »). */
  history: DayUsage[];
}

/**
 * Plafonds éditables depuis le footer réglages (tâche #13), en tokens
 * pondérés. Alignés sur `CapsSettings` côté Rust (`collector::snapshot`).
 * Nullable (#23) : `settings.ts::effectiveCaps` derive les valeurs par
 * defaut depuis `gauges.*.cap`, qui est `null` en mode officiel — jamais
 * envoye a null au backend en pratique (la saisie utilisateur reste un
 * entier positif, cf. `toNonNegativeInt`).
 */
export interface CapsSettings {
  block_5h: number | null;
  weekly: number | null;
  weekly_fable: number | null;
}

/**
 * Personnalisation du junimo (tâche #33) : forme, couleur, accessoire, nom
 * affiché dans le header. Alignée sur `JunimoSettings` côté Rust
 * (`collector::snapshot`) — mêmes défauts (classic/green/none/« Junimo »),
 * appliqués côté Rust par `sanitize_junimo` (jamais de valeur inconnue
 * propagée au front).
 */
export interface JunimoSettings {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
  name: string;
}

/**
 * Réglages persistés dans `junimo-settings.json`, lus/écrits via
 * `get_settings`/`set_settings`. Alignés sur `AppSettings` côté Rust.
 */
export interface AppSettings {
  caps: CapsSettings | null;
  weekly_reset_reference: string | null;
  global_shortcut: string | null;
  junimo: JunimoSettings;
}

/**
 * Statut du raccourci clavier global (tâche #12), lu via
 * `get_shortcut_status`. Aligné sur `ShortcutStatus` côté Rust.
 */
export interface ShortcutStatus {
  accelerator: string;
  registered: boolean;
  error: string | null;
}
