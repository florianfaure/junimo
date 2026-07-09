/** Etat degrade partage par les 3 sections quand leur source de donnees echoue. */
export function renderDegradedSection(title: string, sectionKey: string): string {
  return `
    <section class="panel section is-degraded" data-section="${sectionKey}">
      <div class="section-head">
        <h2 class="pixel-label section-title">${title}</h2>
      </div>
      <div class="degraded-state">
        <span class="degraded-badge mono" aria-hidden="true">!</span>
        <p class="mono degraded-text">données indisponibles</p>
      </div>
    </section>`;
}
