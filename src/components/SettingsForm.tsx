import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { TextInput } from "@astryxdesign/core/TextInput";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { AppSettings, CapsSettings, ShortcutStatus, Snapshot } from "../types";
import { Panel } from "./Panel";

/** Données réglages chargées via invoke, en plus du Snapshot habituel. */
export interface SettingsPanelData {
  settings: AppSettings;
  autostart: boolean;
  shortcutStatus: ShortcutStatus;
}

/**
 * Valeurs mock utilisées hors Tauri (npm run dev dans un navigateur) : le
 * formulaire reste affichable/manipulable sans backend, le save y est un
 * no-op logué.
 */
export const mockSettingsData: SettingsPanelData = {
  settings: {
    caps: null,
    weekly_reset_reference: null,
    global_shortcut: null,
    junimo: { shape: "classic", color: "green", accessory: "none", name: "Junimo" },
  },
  autostart: false,
  shortcutStatus: { accelerator: "Alt+Cmd+J", registered: true, error: null },
};

/**
 * Plafonds effectifs à pré-remplir : ceux des réglages persistés s'ils existent,
 * sinon les caps courants du snapshot (déjà résolus côté backend).
 */
function effectiveCaps(settings: AppSettings, snapshot: Snapshot): CapsSettings {
  if (settings.caps) return settings.caps;
  return {
    block_5h: snapshot.gauges.block_5h.cap,
    weekly: snapshot.gauges.weekly.cap,
    weekly_fable: snapshot.gauges.weekly_fable.cap,
  };
}

/** null/NaN/négatif -> 0 ; sinon arrondi (jamais de NaN ni de négatif envoyé au backend). */
function clampInt(value: number | null): number {
  return value === null || !Number.isFinite(value) || value < 0 ? 0 : Math.round(value);
}

/** Chaîne vide (ou espaces) -> null, sinon la valeur trimmée. */
function toNullableTrimmed(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Formulaire réglages (ex-footer repliable, déplacé sur la page Réglages
 * dédiée à la tâche #27). Champs contrôlés : plafonds (mode estimé),
 * référence hebdo, raccourci global, lancement au démarrage. Sauvegarde via
 * `set_settings` (+ `set_autostart` si changé), puis `onSaved` recharge et
 * re-render côté App.
 *
 * Resync des champs (fix review #25) : l'état local était initialisé une
 * seule fois au mount via `useState(initialCaps...)`, sans jamais se
 * remettre à jour quand `data`/`snapshot` changeaient ensuite (ex. après un
 * enregistrement qui vide les plafonds persistés). En mode estimé, rouvrir
 * le formulaire ne re-préremplissait alors plus avec `effectiveCaps`. Le
 * `useEffect` ci-dessous resynchronise explicitement les champs à chaque
 * changement de référence de `data`/`snapshot` — ce qui, grâce à la garde
 * anti-écrasement de `useOverlayData` (settingsOpenRef), ne se produit que
 * lors du chargement initial ou juste après un `onSaved()`, jamais pendant
 * une frappe en cours.
 */
export function SettingsForm({
  snapshot,
  data,
  isTauri,
  onSaved,
}: {
  snapshot: Snapshot;
  data: SettingsPanelData;
  isTauri: boolean;
  onSaved: () => void;
}) {
  const [block5h, setBlock5h] = useState<number | null>(
    () => effectiveCaps(data.settings, snapshot).block_5h,
  );
  const [weekly, setWeekly] = useState<number | null>(
    () => effectiveCaps(data.settings, snapshot).weekly,
  );
  const [weeklyFable, setWeeklyFable] = useState<number | null>(
    () => effectiveCaps(data.settings, snapshot).weekly_fable,
  );
  const [weeklyReference, setWeeklyReference] = useState(data.settings.weekly_reset_reference ?? "");
  const [globalShortcut, setGlobalShortcut] = useState(data.settings.global_shortcut ?? "");
  const [autostart, setAutostart] = useState(data.autostart);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const caps = effectiveCaps(data.settings, snapshot);
    setBlock5h(caps.block_5h);
    setWeekly(caps.weekly);
    setWeeklyFable(caps.weekly_fable);
    setWeeklyReference(data.settings.weekly_reset_reference ?? "");
    setGlobalShortcut(data.settings.global_shortcut ?? "");
    setAutostart(data.autostart);
  }, [data, snapshot]);

  async function handleSave() {
    const allCapsEmpty = [block5h, weekly, weeklyFable].every((v) => v === null);
    const settings: AppSettings = {
      caps: allCapsEmpty
        ? null
        : { block_5h: clampInt(block5h), weekly: clampInt(weekly), weekly_fable: clampInt(weeklyFable) },
      weekly_reset_reference: toNullableTrimmed(weeklyReference),
      global_shortcut: toNullableTrimmed(globalShortcut),
      // Ce formulaire n'édite pas la personnalisation du junimo (tâche #33,
      // voir JunimoEditorPage) : on recopie le bloc courant tel quel pour ne
      // jamais l'écraser depuis la page Réglages.
      junimo: data.settings.junimo,
    };
    const autostartChanged = autostart !== data.autostart;

    if (!isTauri) {
      // Hors Tauri : invoke() n'existe pas, on logue l'intention pour pouvoir
      // développer/tester le formulaire visuellement sans backend Tauri.
      console.log("Junimo (dev, hors Tauri) : set_settings serait appele avec", settings);
      if (autostartChanged) {
        console.log("Junimo (dev, hors Tauri) : set_autostart serait appele avec", autostart);
      }
    } else {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_settings", { settings });
      if (autostartChanged) {
        await invoke("set_autostart", { enabled: autostart });
      }
    }

    setFeedback("enregistré ✓");
    setTimeout(() => setFeedback(""), 2000);
    onSaved();
  }

  const shortcutStatus = data.shortcutStatus;

  return (
    <Panel title="Réglages">
      <VStack gap={2}>
        <NumberInput
          label="Plafond bloc 5h"
          description="utilisé uniquement en mode estimé (repli)"
          value={block5h}
          min={0}
          step={1}
          isIntegerOnly
          hasClear
          onChange={setBlock5h}
        />
        <NumberInput
          label="Plafond 7j global"
          description="utilisé uniquement en mode estimé (repli)"
          value={weekly}
          min={0}
          step={1}
          isIntegerOnly
          hasClear
          onChange={setWeekly}
        />
        <NumberInput
          label="Plafond 7j Fable/Opus"
          description="utilisé uniquement en mode estimé (repli)"
          value={weeklyFable}
          min={0}
          step={1}
          isIntegerOnly
          hasClear
          onChange={setWeeklyFable}
        />
        <TextInput
          label="Référence reset hebdo"
          description="utilisée uniquement en mode estimé (repli)"
          placeholder="2026-07-15T00:00:00+02:00"
          value={weeklyReference}
          onChange={setWeeklyReference}
        />
        <TextInput
          label="Raccourci global"
          description="pris en compte au prochain démarrage"
          placeholder="Alt+Cmd+J"
          value={globalShortcut}
          onChange={setGlobalShortcut}
        />
        <CheckboxInput
          label="Lancer au démarrage"
          value={autostart}
          onChange={(checked) => setAutostart(checked)}
        />
        {shortcutStatus.registered ? (
          <Text type="supporting">raccourci : {shortcutStatus.accelerator}</Text>
        ) : (
          <Text type="supporting" color="accent">
            raccourci non enregistré : {shortcutStatus.error ?? "erreur inconnue"}
          </Text>
        )}
        <HStack gap={2} align="center">
          <Button label="Enregistrer" variant="primary" onClick={() => void handleSave()} />
          {feedback ? <Text type="supporting">{feedback}</Text> : null}
        </HStack>
      </VStack>
    </Panel>
  );
}
