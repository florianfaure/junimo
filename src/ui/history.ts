import type { DayUsage } from "../types";
import { formatDayShort, formatTokens } from "./format";

/** Hauteur max d'une barre en px (le conteneur ajoute un peu de marge). */
const BAR_MAX_PX = 40;
/** Hauteur minimale visible d'une barre non nulle (repère « il y a eu de l'usage »). */
const BAR_MIN_PX = 2;

/**
 * Une colonne du bar-chart. Hauteur proportionnelle au max de la période
 * (min 2px dès qu'il y a de l'usage, 0 pour un jour vide). La journée max de
 * la période passe en orange (repère « journée lourde »), le dernier jour
 * (aujourd'hui) reçoit une surbrillance discrète.
 */
function renderBar(day: DayUsage, maxTokens: number, isMax: boolean, isToday: boolean): string {
  let heightPx = 0;
  if (day.tokens > 0) {
    const ratio = maxTokens > 0 ? day.tokens / maxTokens : 0;
    heightPx = Math.max(BAR_MIN_PX, Math.round(ratio * BAR_MAX_PX));
  }
  const level = isMax ? "max" : "normal";
  const todayAttr = isToday ? ' data-today="true"' : "";
  const title = `${formatDayShort(day.date)} · ${formatTokens(day.tokens)} tok`;
  return `
    <div class="history-col" title="${title}">
      <span class="history-bar" data-level="${level}"${todayAttr} style="height: ${heightPx}px"></span>
    </div>`;
}

/**
 * Section « Historique » : mini bar-chart pixel de la consommation
 * quotidienne sur 14 jours (façon météo Stardew), pour repérer les journées
 * lourdes et anticiper la jauge hebdo. Pur affichage (les données sont déjà
 * agrégées côté backend, `snapshot.history`).
 */
export function renderHistorySection(history: DayUsage[] | undefined): string {
  if (!history || history.length === 0) {
    return `
      <section class="panel section" data-section="history">
        <div class="section-head">
          <h2 class="pixel-label section-title">Historique</h2>
        </div>
        <p class="mono empty-hint">pas d'historique</p>
      </section>`;
  }

  const maxTokens = history.reduce((max, day) => Math.max(max, day.tokens), 0);
  // Première journée atteignant le max (repère « journée lourde »).
  const maxIndex = maxTokens > 0 ? history.findIndex((day) => day.tokens === maxTokens) : -1;
  const lastIndex = history.length - 1;

  const bars = history
    .map((day, i) => renderBar(day, maxTokens, i === maxIndex, i === lastIndex))
    .join("");

  const firstLabel = formatDayShort(history[0].date);

  return `
    <section class="panel section" data-section="history">
      <div class="section-head">
        <h2 class="pixel-label section-title">Historique</h2>
        <span class="mono history-tag">14j</span>
      </div>
      <div class="history-chart">
        ${bars}
      </div>
      <div class="history-axis mono">
        <span>${firstLabel}</span>
        <span>aujourd'hui</span>
      </div>
    </section>`;
}
