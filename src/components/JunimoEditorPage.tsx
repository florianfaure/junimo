import { useEffect, useRef, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Panel } from "./Panel";
import { JunimoSprite } from "./JunimoSprite";
import {
  JUNIMO_ACCESSORIES,
  JUNIMO_COLORS,
  JUNIMO_SHAPES,
  type JunimoAccessoryId,
  type JunimoColorId,
  type JunimoShapeId,
} from "../junimo/compose";
import type { AppSettings } from "../types";
import type { SettingsPanelData } from "./SettingsForm";

/** Longueur max acceptée côté saisie (le backend retombe sur "Junimo" au-delà, voir sanitize_junimo). */
const NAME_MAX_LEN = 40;

/**
 * Page dédiée à l'éditeur du junimo (forme / couleur / accessoire / nom),
 * atteinte en cliquant sur le sprite du header (tâche #27 pour la navigation,
 * tâche #32 pour `composeJunimo`). Persistance dans `junimo-settings.json` via
 * le mécanisme réglages existant (`set_settings`) : le bloc `junimo` est mis à
 * jour, le reste de `AppSettings` (caps, weekly_reset_reference,
 * global_shortcut) est recopié tel quel — cette page ne les édite pas.
 *
 * Pattern de sauvegarde identique à `SettingsForm` : état contrôlé local
 * resynchronisé quand `data` change (rechargement après un save), invoke
 * `set_settings` sous Tauri, no-op logué hors Tauri (mode dev navigateur),
 * feedback visuel temporaire, `onSaved` déclenche le refetch côté App.
 */
export function JunimoEditorPage({
  data,
  isTauri,
  onBack,
  onSaved,
}: {
  data: SettingsPanelData;
  isTauri: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [shape, setShape] = useState<JunimoShapeId>(data.settings.junimo.shape);
  const [color, setColor] = useState<JunimoColorId>(data.settings.junimo.color);
  const [accessory, setAccessory] = useState<JunimoAccessoryId>(data.settings.junimo.accessory);
  const [name, setName] = useState(data.settings.junimo.name);
  const [feedback, setFeedback] = useState("");

  // Navigation clavier du radiogroup de swatches (fix review #33) : tabindex
  // roving (seule la swatch sélectionnée est tabbable) + flèches pour parcourir
  // la grille. Les refs permettent de déplacer le focus sur la nouvelle swatch.
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onSwatchKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const current = JUNIMO_COLORS.findIndex((c) => c.id === color);
    if (current < 0) return;
    let next = current;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % JUNIMO_COLORS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + JUNIMO_COLORS.length) % JUNIMO_COLORS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = JUNIMO_COLORS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setColor(JUNIMO_COLORS[next].id);
    swatchRefs.current[next]?.focus();
  }

  // Accessoire : même pattern radiogroup à roving tabindex que les swatches
  // couleur ci-dessus (fix #26 — à 360px, le SegmentedControl Astryx pour 5
  // items débordait : "Fleur" coupé au bord droit, cf. captures QA. Les 5
  // libellés (Aucun/Chapeau/Nœud/Lunettes/Fleur) dépassent la largeur
  // disponible dans le Panel une fois posés côte à côte, et le DS n'a pas de
  // variante "wrap" pour SegmentedControl. On passe donc sur la même grille de
  // boutons `role="radio"` qui wrap en flex — garantit de tenir sur 360px quel
  // que soit le nombre/la longueur des libellés, sans rien couper).
  const accessoryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onAccessoryKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const current = JUNIMO_ACCESSORIES.findIndex((a) => a.id === accessory);
    if (current < 0) return;
    let next = current;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % JUNIMO_ACCESSORIES.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + JUNIMO_ACCESSORIES.length) % JUNIMO_ACCESSORIES.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = JUNIMO_ACCESSORIES.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setAccessory(JUNIMO_ACCESSORIES[next].id);
    accessoryRefs.current[next]?.focus();
  }

  // Resync si les réglages rechargent (ex. juste après un `onSaved()`),
  // même garde que SettingsForm — n'écrase jamais une saisie en cours car
  // `data` ne change que sur un vrai rechargement backend.
  useEffect(() => {
    setShape(data.settings.junimo.shape);
    setColor(data.settings.junimo.color);
    setAccessory(data.settings.junimo.accessory);
    setName(data.settings.junimo.name);
  }, [data]);

  async function handleSave() {
    const trimmed = name.trim();
    const settings: AppSettings = {
      ...data.settings,
      junimo: {
        shape,
        color,
        accessory,
        // Champ vide -> défaut "Junimo" (même règle que `sanitize_junimo`
        // côté Rust, appliquée ici aussi pour un feedback immédiat cohérent).
        name: trimmed === "" ? "Junimo" : trimmed,
      },
    };

    if (!isTauri) {
      console.log("Junimo (dev, hors Tauri) : set_settings serait appele avec", settings);
    } else {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_settings", { settings });
    }

    setFeedback("enregistré ✓");
    setTimeout(() => setFeedback(""), 2000);
    onSaved();
  }

  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center">
          <Button label="Retour" variant="ghost" icon={<Icon icon="chevronLeft" />} onClick={onBack} />
          <Heading level={1}>Éditeur du junimo</Heading>
        </HStack>

        <Panel title="Aperçu">
          <HStack justify="center" align="center" padding={2}>
            <JunimoSprite spec={{ shape, color, accessory }} scale={5} label={name || "Junimo"} />
          </HStack>
        </Panel>

        <Panel title="Personnalisation">
          <VStack gap={3}>
            <VStack gap={1}>
              <Text type="supporting">Forme</Text>
              <SegmentedControl value={shape} onChange={(v) => setShape(v as JunimoShapeId)} label="Forme du junimo">
                {JUNIMO_SHAPES.map((s) => (
                  <SegmentedControlItem key={s.id} value={s.id} label={s.label} />
                ))}
              </SegmentedControl>
            </VStack>

            <VStack gap={1}>
              <Text type="supporting">Couleur</Text>
              <div
                role="radiogroup"
                aria-label="Couleur du junimo"
                className="junimo-swatch-grid"
                onKeyDown={onSwatchKeyDown}
              >
                {JUNIMO_COLORS.map((c, i) => (
                  <button
                    key={c.id}
                    ref={(el) => {
                      swatchRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={color === c.id}
                    aria-label={c.label}
                    title={c.label}
                    tabIndex={color === c.id ? 0 : -1}
                    className={
                      color === c.id ? "junimo-swatch junimo-swatch--selected" : "junimo-swatch"
                    }
                    style={{ backgroundColor: c.swatch }}
                    onClick={() => setColor(c.id)}
                  />
                ))}
              </div>
            </VStack>

            <VStack gap={1}>
              <Text type="supporting">Accessoire</Text>
              <div
                role="radiogroup"
                aria-label="Accessoire du junimo"
                className="junimo-chip-grid"
                onKeyDown={onAccessoryKeyDown}
              >
                {JUNIMO_ACCESSORIES.map((a, i) => (
                  <button
                    key={a.id}
                    ref={(el) => {
                      accessoryRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={accessory === a.id}
                    tabIndex={accessory === a.id ? 0 : -1}
                    className={
                      accessory === a.id ? "junimo-chip junimo-chip--selected" : "junimo-chip"
                    }
                    onClick={() => setAccessory(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </VStack>

            <TextInput
              label="Nom"
              placeholder="Junimo"
              value={name}
              onChange={(v) => setName(v.slice(0, NAME_MAX_LEN))}
            />

            <HStack gap={2} align="center">
              <Button label="Enregistrer" variant="primary" onClick={() => void handleSave()} />
              {feedback ? <Text type="supporting">{feedback}</Text> : null}
            </HStack>
          </VStack>
        </Panel>
      </VStack>
    </div>
  );
}
