import type { AppSettings, CapsSettings, ShortcutStatus, Snapshot } from "../types";
import { escapeHtml } from "./format";

/** Donnees reglages chargees via invoke, en plus du Snapshot habituel. */
export interface SettingsPanelData {
  settings: AppSettings;
  autostart: boolean;
  shortcutStatus: ShortcutStatus;
}

/**
 * Valeurs mock utilisees hors Tauri (npm run dev dans un navigateur) : le
 * footer reste affichable et manipulable sans backend, le save y est un
 * no-op logue (voir bindSettingsEvents).
 */
export const mockSettingsData: SettingsPanelData = {
  settings: { caps: null, weekly_reset_reference: null, global_shortcut: null },
  autostart: false,
  shortcutStatus: { accelerator: "Alt+Cmd+J", registered: true, error: null },
};

/**
 * Plafonds effectifs a pre-remplir : ceux des reglages persistes s'ils
 * existent, sinon les caps courants du snapshot (deja resolus cote backend
 * depuis le tier detecte, voir `resolve_caps`).
 */
function effectiveCaps(settings: AppSettings, snapshot: Snapshot): CapsSettings {
  if (settings.caps) return settings.caps;
  return {
    block_5h: snapshot.gauges.block_5h.cap,
    weekly: snapshot.gauges.weekly.cap,
    weekly_fable: snapshot.gauges.weekly_fable.cap,
  };
}

function renderShortcutStatus(status: ShortcutStatus): string {
  if (!status.registered) {
    return `<p class="mono settings-shortcut-status settings-shortcut-error">raccourci non enregistré : ${escapeHtml(status.error ?? "erreur inconnue")}</p>`;
  }
  return `<p class="mono settings-shortcut-status">raccourci : ${escapeHtml(status.accelerator)}</p>`;
}

/**
 * Rendu du footer reglages compact, sous les 3 sections de l'overlay.
 * `<details>` ferme par defaut : voir `bindSettingsEvents` pour la logique
 * de sauvegarde, et `main.ts` pour la garde qui evite d'ecraser une saisie
 * en cours pendant le polling periodique.
 */
export function renderSettingsFooter(snapshot: Snapshot, data: SettingsPanelData): string {
  const caps = effectiveCaps(data.settings, snapshot);
  const weeklyReference = data.settings.weekly_reset_reference ?? "";
  const globalShortcut = data.settings.global_shortcut ?? "";

  return `
    <details class="panel settings-footer" data-settings-footer>
      <summary class="pixel-label settings-summary">Réglages</summary>
      <div class="settings-body">
        <div class="settings-grid">
          <label class="settings-field">
            <span class="settings-field-label">Plafond bloc 5h</span>
            <input type="number" class="mono settings-input" data-field="block_5h" min="0" step="1" value="${caps.block_5h}" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">Plafond 7j global</span>
            <input type="number" class="mono settings-input" data-field="weekly" min="0" step="1" value="${caps.weekly}" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">Plafond 7j Fable/Opus</span>
            <input type="number" class="mono settings-input" data-field="weekly_fable" min="0" step="1" value="${caps.weekly_fable}" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">Référence reset hebdo</span>
            <input type="text" class="mono settings-input" data-field="weekly_reset_reference" placeholder="2026-07-15T00:00:00+02:00" value="${escapeHtml(weeklyReference)}" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">Raccourci global</span>
            <input type="text" class="mono settings-input" data-field="global_shortcut" placeholder="Alt+Cmd+J" value="${escapeHtml(globalShortcut)}" />
            <span class="settings-hint">pris en compte au prochain démarrage</span>
          </label>
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-field="autostart" data-initial="${data.autostart ? "true" : "false"}" ${data.autostart ? "checked" : ""} />
          <span class="mono">Lancer au démarrage</span>
        </label>
        ${renderShortcutStatus(data.shortcutStatus)}
        <div class="settings-actions">
          <button type="button" class="pixel-label settings-save" data-settings-save>Enregistrer</button>
          <span class="mono settings-feedback" data-settings-feedback></span>
        </div>
      </div>
    </details>`;
}

/** "3.5" -> 3, "" / "abc" / "-2" -> 0 (defensif : jamais de NaN ni de negatif envoye au backend). */
function toNonNegativeInt(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

/** Chaine vide (ou seulement des espaces) -> null, sinon la valeur trimmee. */
function toNullableTrimmed(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

async function handleSave(details: HTMLDetailsElement, isTauri: boolean, onSaved: () => void): Promise<void> {
  const field = (name: string) => details.querySelector<HTMLInputElement>(`[data-field="${name}"]`);

  const block5hInput = field("block_5h");
  const weeklyInput = field("weekly");
  const weeklyFableInput = field("weekly_fable");
  const weeklyReferenceInput = field("weekly_reset_reference");
  const globalShortcutInput = field("global_shortcut");
  const autostartInput = field("autostart") as HTMLInputElement | null;
  const feedback = details.querySelector<HTMLElement>("[data-settings-feedback]");

  const rawCaps = [block5hInput?.value ?? "", weeklyInput?.value ?? "", weeklyFableInput?.value ?? ""];
  const allCapsEmpty = rawCaps.every((v) => v.trim() === "");

  const settings: AppSettings = {
    caps: allCapsEmpty
      ? null
      : {
          block_5h: toNonNegativeInt(block5hInput?.value),
          weekly: toNonNegativeInt(weeklyInput?.value),
          weekly_fable: toNonNegativeInt(weeklyFableInput?.value),
        },
    weekly_reset_reference: toNullableTrimmed(weeklyReferenceInput?.value),
    global_shortcut: toNullableTrimmed(globalShortcutInput?.value),
  };

  const autostartEnabled = autostartInput?.checked ?? false;
  const autostartChanged = autostartInput ? autostartInput.dataset.initial !== String(autostartEnabled) : false;

  if (!isTauri) {
    // Hors Tauri (npm run dev dans un navigateur) : invoke() n'existe pas,
    // on se contente de logguer l'intention pour pouvoir developper/tester
    // le footer visuellement sans backend Tauri.
    console.log("Junimo (dev, hors Tauri) : set_settings serait appele avec", settings);
    if (autostartChanged) {
      console.log("Junimo (dev, hors Tauri) : set_autostart serait appele avec", autostartEnabled);
    }
  } else {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_settings", { settings });
    if (autostartChanged) {
      await invoke("set_autostart", { enabled: autostartEnabled });
    }
  }

  if (feedback) {
    feedback.textContent = "enregistré ✓";
    setTimeout(() => {
      feedback.textContent = "";
    }, 2000);
  }

  onSaved();
}

/**
 * Attache les listeners du footer reglages APRES chaque render (qui
 * remplace tout le innerHTML de #app, voir `render.ts`). `onSaved` recharge
 * les donnees reglages et re-render cote appelant (`main.ts`).
 */
export function bindSettingsEvents(app: HTMLElement, isTauri: boolean, onSaved: () => void): void {
  const details = app.querySelector<HTMLDetailsElement>("[data-settings-footer]");
  const button = app.querySelector<HTMLButtonElement>("[data-settings-save]");
  if (!details || !button) return;

  button.addEventListener("click", () => {
    void handleSave(details, isTauri, onSaved);
  });
}
