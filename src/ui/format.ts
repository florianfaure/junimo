/** Formatteurs purs — aucune logique metier, uniquement de l'affichage. */

export type GaugeLevel = "green" | "orange" | "red";

/** Seuils d'alerte des jauges : vert < 60 %, orange 60-84 %, rouge >= 85 %. */
export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 85) return "red";
  if (percent >= 60) return "orange";
  return "green";
}

/** 306000 -> "306k", 2562000 -> "2.56M", 842 -> "842". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}

/** "reset 21:00" si meme jour que la reference, sinon "reset 13/07 09:00". */
export function formatResetAt(iso: string, referenceIso: string): string {
  const d = new Date(iso);
  const ref = new Date(referenceIso);
  if (Number.isNaN(d.getTime())) return "reset —";
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === ref.toDateString();
  if (sameDay) return `reset ${time}`;
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `reset ${date} ${time}`;
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
