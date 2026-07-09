/**
 * Snapshot — contrat de donnees partage avec le backend Tauri (src-tauri/collector).
 * Le front est un pur affichage : aucune logique metier ici, uniquement des types.
 */

export interface Gauge {
  /** Tokens consommes sur la fenetre (input + output + cache_creation + cache_read). */
  used_tokens: number;
  /** Plafond estime pour cette fenetre (constante calibrable selon le plan). */
  cap: number;
  /** used_tokens / cap * 100, arrondi cote backend. */
  percent: number;
  /** Horodatage ISO 8601 du prochain reset de la fenetre. */
  reset_at: string;
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
  /** Rappel permanent : les jauges sont des estimations locales, pas les vrais quotas Anthropic. */
  estimated: true;
}

export interface Snapshot {
  gauges: Gauges;
  mcps: McpServer[];
  account: Account;
  meta: Meta;
}
