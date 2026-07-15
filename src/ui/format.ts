/** Formatteurs purs — aucune logique metier, uniquement de l'affichage. */

export type GaugeLevel = "green" | "orange" | "red";

/** Seuils d'alerte des jauges : vert < 60 %, orange 60-84 %, rouge >= 85 %. */
export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 85) return "red";
  if (percent >= 60) return "orange";
  return "green";
}

/** 25.966666 -> "25.97", 34 -> "34", 100 -> "100" (max 2 décimales). */
export function formatPercent(percent: number): string {
  return `${Math.round(percent * 100) / 100}`;
}

/** 306000 -> "306k", 2562000 -> "2.56M", 842 -> "842". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}

/**
 * Reformate une date ISO "YYYY-MM-DD" en "JJ/MM" (ex. "2026-07-12" ->
 * "12/07"). Entrée inattendue -> renvoyée telle quelle (défensif).
 */
export function formatDayShort(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [, month, day] = parts;
  return `${day}/${month}`;
}

/** "reset 21:00" si meme jour que la reference, sinon "reset 13/07 09:00". `null` -> "reset —". */
export function formatResetAt(iso: string | null, referenceIso: string): string {
  if (!iso) return "reset —";
  const d = new Date(iso);
  const ref = new Date(referenceIso);
  if (Number.isNaN(d.getTime())) return "reset —";
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === ref.toDateString();
  if (sameDay) return `reset ${time}`;
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `reset ${date} ${time}`;
}

/**
 * Duree formatee de maniere compacte en francais, arrondie a la minute :
 * "2h 13m", "45m", "3j 4h" (jours des que la duree atteint 24h). Jamais
 * negatif (clamp a 0) ; en dessous d'une minute -> "<1m".
 */
export function formatDurationShort(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalMinutes = Math.round(clamped / 60_000);
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Pied de jauge du bloc 5h en mode officiel : `null` (aucune session en
 * cours) -> "aucune session en cours" ; sinon la duree restante avant reset,
 * ex. "reset dans 2h 13m".
 */
export function formatBlockReset(resetAt: string | null, nowIso: string): string {
  if (!resetAt) return "aucune session en cours";
  const reset = new Date(resetAt);
  const now = new Date(nowIso);
  if (Number.isNaN(reset.getTime()) || Number.isNaN(now.getTime())) return "aucune session en cours";
  return `reset dans ${formatDurationShort(reset.getTime() - now.getTime())}`;
}

/**
 * Pied de jauge hebdomadaire en mode officiel : `null` -> "reset —" ; moins
 * de 24h restantes -> compte a rebours ("reset dans 21h 05m") ; au-dela ->
 * date courte jj/mm ("reset 21/07").
 */
export function formatWeeklyResetOfficial(resetAt: string | null, nowIso: string): string {
  if (!resetAt) return "reset —";
  const reset = new Date(resetAt);
  const now = new Date(nowIso);
  if (Number.isNaN(reset.getTime()) || Number.isNaN(now.getTime())) return "reset —";
  const diffMs = reset.getTime() - now.getTime();
  if (diffMs < 24 * 60 * 60 * 1000) return `reset dans ${formatDurationShort(diffMs)}`;
  const date = reset.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `reset ${date}`;
}

/**
 * Ancienneté relative compacte d'un horodatage ISO par rapport a une
 * reference : "Xmin" (< 60 min), "Xh" (< 24 h), sinon "Xj". `null` ou date
 * invalide -> "—". Un ecart negatif (futur) est ramene a "0min".
 */
export function formatRelativeAgo(iso: string | null, referenceIso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const ref = new Date(referenceIso);
  if (Number.isNaN(d.getTime()) || Number.isNaN(ref.getTime())) return "—";
  const diffMs = Math.max(0, ref.getTime() - d.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}j`;
}

/**
 * Le backend renvoie parfois `account.plan` a l'etat brut (ex.
 * "stripe_subscription") quand l'organisation ne permet pas de mapper vers
 * un libelle lisible. Dans ce cas, on derive un affichage depuis `tier`
 * (ex. tier "claude_max_5x" -> "Max · 5x"). Sinon, `plan` est deja lisible
 * et on l'affiche tel quel accole au tier.
 */
export function resolvePlanDisplay(plan: string, tier: string): string {
  const looksRaw = plan.includes("_") || plan.toLowerCase().includes("subscription");
  if (!looksRaw) return `${plan} · ${tier}`;

  const t = tier.toLowerCase();
  if (t.includes("max_20x")) return "Max · 20x";
  if (t.includes("max_5x")) return "Max · 5x";
  if (t.includes("max")) return "Max";
  if (t.includes("pro")) return "Pro";
  return tier;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
