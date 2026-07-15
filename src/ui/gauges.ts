import type { Gauge, Gauges } from "../types";
import { renderDegradedSection } from "./degraded";
import {
  formatBlockReset,
  formatPercent,
  formatResetAt,
  formatTokens,
  formatWeeklyResetOfficial,
  gaugeLevel,
} from "./format";

const SEGMENTS = 16;

/** Type de fenetre de la jauge : le bloc 5h affiche une duree restante, les hebdos une date au-dela de 24h. */
type WindowKind = "block" | "weekly";

function renderBar(percent: number, level: string): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * SEGMENTS);
  let segments = "";
  for (let i = 0; i < SEGMENTS; i++) {
    segments += `<span class="segment${i < filled ? " filled" : ""}"></span>`;
  }
  return `<div class="gauge-bar" data-level="${level}">${segments}</div>`;
}

/** Pied de jauge en mode officiel : uniquement le reset (pas de compteur tokens, non expose par l'API du compte). */
function renderOfficialFoot(gauge: Gauge, windowKind: WindowKind, nowIso: string): string {
  const reset =
    windowKind === "block" ? formatBlockReset(gauge.reset_at, nowIso) : formatWeeklyResetOfficial(gauge.reset_at, nowIso);
  return `
      <div class="gauge-row-foot mono">
        <span class="gauge-reset">${reset}</span>
      </div>`;
}

/** Pied de jauge en mode estime : compteur tokens (si connu, null-safe) + reset absolu. */
function renderEstimatedFoot(gauge: Gauge, referenceIso: string): string {
  const usage =
    gauge.used_tokens !== null && gauge.cap !== null
      ? `<span class="gauge-usage">${formatTokens(gauge.used_tokens)} / ${formatTokens(gauge.cap)} tok</span>`
      : "";
  return `
      <div class="gauge-row-foot mono">
        ${usage}
        <span class="gauge-reset">${formatResetAt(gauge.reset_at, referenceIso)}</span>
      </div>`;
}

function renderGaugeRow(
  label: string,
  gauge: Gauge,
  windowKind: WindowKind,
  referenceIso: string,
  nowIso: string,
): string {
  const level = gaugeLevel(gauge.percent);
  const foot =
    gauge.source === "official"
      ? renderOfficialFoot(gauge, windowKind, nowIso)
      : renderEstimatedFoot(gauge, referenceIso);
  return `
    <div class="gauge-row">
      <div class="gauge-row-head">
        <span class="pixel-label gauge-name">${label}</span>
        <span class="mono gauge-percent" data-level="${level}">${formatPercent(gauge.percent)}%</span>
      </div>
      ${renderBar(gauge.percent, level)}
      ${foot}
    </div>`;
}

export function renderGaugesSection(
  gauges: Gauges | undefined,
  degraded: boolean,
  referenceIso: string,
  nowIso: string,
): string {
  if (degraded || !gauges) {
    return renderDegradedSection("Jauges", "gauges");
  }
  // Les 3 jauges partagent toujours la meme source (cf. contrat backend) :
  // le tag "estimé" ne depend que du bloc 5h.
  const isEstimated = gauges.block_5h.source === "estimated";
  return `
    <section class="panel section" data-section="gauges">
      <div class="section-head">
        <h2 class="pixel-label section-title">Jauges</h2>
        ${isEstimated ? `<span class="mono estimated-tag" title="Estimation locale, pas un quota officiel Anthropic">estimé</span>` : ""}
      </div>
      <div class="gauge-list">
        ${renderGaugeRow("Bloc 5h", gauges.block_5h, "block", referenceIso, nowIso)}
        ${renderGaugeRow("7j global", gauges.weekly, "weekly", referenceIso, nowIso)}
        ${renderGaugeRow("7j Fable/Opus", gauges.weekly_fable, "weekly", referenceIso, nowIso)}
      </div>
    </section>`;
}
