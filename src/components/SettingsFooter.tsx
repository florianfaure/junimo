import { useState } from "react";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { TextInput } from "@astryxdesign/core/TextInput";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { AppSettings, CapsSettings, ShortcutStatus, Snapshot } from "../types";

/** Données réglages chargées via invoke, en plus du Snapshot habituel. */
export interface SettingsPanelData {
  settings: AppSettings;
  autostart: boolean;
  shortcutStatus: ShortcutStatus;
}

/**
 * Valeurs mock utilisées hors Tauri (npm run dev dans un navigateur) : le footer
 * reste affichable/manipulable sans backend, le save y est un no-op logué.
 */
export const mockSettingsData: SettingsPanelData = {
  settings: { caps: null, weekly_reset_reference: null, global_shortcut: null },
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
 * Footer réglages repliable (ex-`<details>`), désormais un Collapsible Astryx
 * contrôlé par l'App (garde anti-écrasement pendant le polling, cf.
 * useOverlayData). Champs contrôlés : plafonds (mode estimé), référence hebdo,
 * raccourci global, lancement au démarrage. Sauvegarde via `set_settings`
 * (+ `set_autostart` si changé), puis `onSaved` recharge et re-render côté App.
 */
export function SettingsFooter({
  snapshot,
  data,
  isTauri,
  isOpen,
  onOpenChange,
  onSaved,
}: {
  snapshot: Snapshot;
  data: SettingsPanelData;
  isTauri: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const initialCaps = effectiveCaps(data.settings, snapshot);
  const [block5h, setBlock5h] = useState<number | null>(initialCaps.block_5h);
  const [weekly, setWeekly] = useState<number | null>(initialCaps.weekly);
  const [weeklyFable, setWeeklyFable] = useState<number | null>(initialCaps.weekly_fable);
  const [weeklyReference, setWeeklyReference] = useState(data.settings.weekly_reset_reference ?? "");
  const [globalShortcut, setGlobalShortcut] = useState(data.settings.global_shortcut ?? "");
  const [autostart, setAutostart] = useState(data.autostart);
  const [feedback, setFeedback] = useState("");

  async function handleSave() {
    const allCapsEmpty = [block5h, weekly, weeklyFable].every((v) => v === null);
    const settings: AppSettings = {
      caps: allCapsEmpty
        ? null
        : { block_5h: clampInt(block5h), weekly: clampInt(weekly), weekly_fable: clampInt(weeklyFable) },
      weekly_reset_reference: toNullableTrimmed(weeklyReference),
      global_shortcut: toNullableTrimmed(globalShortcut),
    };
    const autostartChanged = autostart !== data.autostart;

    if (!isTauri) {
      // Hors Tauri : invoke() n'existe pas, on logue l'intention pour pouvoir
      // développer/tester le footer visuellement sans backend Tauri.
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
    <Collapsible
      trigger={<Text type="label">Réglages</Text>}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <VStack gap={2} style={{ paddingTop: 8 }}>
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
    </Collapsible>
  );
}
