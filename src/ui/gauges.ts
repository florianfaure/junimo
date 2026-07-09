import type { Gauge, Gauges } from "../types";
import { renderDegradedSection } from "./degraded";
import { formatResetAt, formatTokens, gaugeLevel } from "./format";

const SEGMENTS = 16;

function renderBar(percent: number, level: string): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * SEGMENTS);
  let segments = "";
  for (let i = 0; i < SEGMENTS; i++) {
    segments += `<span class="segment${i < filled ? " filled" : ""}"></span>`;
  }
  return `<div class="gauge-bar" data-level="${level}">${segments}</div>`;
}

function renderGaugeRow(label: string, gauge: Gauge, referenceIso: string): string {
  const level = gaugeLevel(gauge.percent);
  return `
    <div class="gauge-row">
      <div class="gauge-row-head">
        <span class="pixel-label gauge-name">${label}</span>
        <span class="mono gauge-percent" data-level="${level}">${gauge.percent}%</span>
      </div>
      ${renderBar(gauge.percent, level)}
      <div class="gauge-row-foot mono">
        <span class="gauge-usage">${formatTokens(gauge.used_tokens)} / ${formatTokens(gauge.cap)} tok</span>
        <span class="gauge-reset">${formatResetAt(gauge.reset_at, referenceIso)}</span>
      </div>
    </div>`;
}

export function renderGaugesSection(gauges: Gauges | undefined, degraded: boolean, referenceIso: string): string {
  if (degraded || !gauges) {
    return renderDegradedSection("Jauges", "gauges");
  }
  return `
    <section class="panel section" data-section="gauges">
      <div class="section-head">
        <h2 class="pixel-label section-title">Jauges</h2>
        <span class="mono estimated-tag" title="Estimation locale, pas un quota officiel Anthropic">estimé</span>
      </div>
      <div class="gauge-list">
        ${renderGaugeRow("Bloc 5h", gauges.block_5h, referenceIso)}
        ${renderGaugeRow("7j global", gauges.weekly, referenceIso)}
        ${renderGaugeRow("7j Fable/Opus", gauges.weekly_fable, referenceIso)}
      </div>
    </section>`;
}
