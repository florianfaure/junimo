/** Etat d'erreur plein ecran : affiche quand get_snapshot echoue avant toute reception. */
export function renderError(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  app.innerHTML = `
    <div class="app-shell">
      <div class="error-state">
        <span class="degraded-badge mono" aria-hidden="true">!</span>
        <p class="pixel-label error-title">Connexion impossible</p>
        <p class="mono error-text">impossible de lire les donnees Claude</p>
      </div>
    </div>`;
}
