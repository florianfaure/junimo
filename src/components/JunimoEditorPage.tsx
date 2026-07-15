import { useCallback, useEffect, useRef, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
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

/** Délai de debounce de l'auto-save (tâche #48, spec §8) : assez court pour
 * que la persistance suive la manipulation sans lag perceptible, assez long
 * pour regrouper une rafale de changements (ex. flèches sur les swatches) en
 * un seul appel `set_settings`. */
const AUTOSAVE_DEBOUNCE_MS = 400;

/**
 * Page dédiée à l'éditeur du junimo (forme / couleur / accessoire / nom),
 * atteinte en cliquant sur le sprite du header (tâche #27 pour la navigation,
 * tâche #32 pour `composeJunimo`). Persistance dans `junimo-settings.json` via
 * le mécanisme réglages existant (`set_settings`) : le bloc `junimo` est mis à
 * jour, le reste de `AppSettings` (caps, weekly_reset_reference,
 * global_shortcut) est recopié tel quel — cette page ne les édite pas.
 *
 * Auto-save (tâche #48) : plus de bouton « Enregistrer », chaque
 * modification (forme/couleur/accessoire/nom) déclenche une sauvegarde
 * automatique après un court debounce (`AUTOSAVE_DEBOUNCE_MS`), via le même
 * flux `set_settings` + `onSaved` qu'avant. Le champ nom flush immédiatement
 * le debounce en cours au blur et au clic sur « Retour » (pas d'attente de
 * 400 ms qui ferait perdre la dernière frappe si l'utilisateur quitte vite).
 * Les sauvegardes sont sérialisées via `saveChainRef` : si un `invoke`
 * précédent est encore en vol quand un nouveau debounce se déclenche, le
 * suivant attend la fin du précédent au lieu de partir en parallèle.
 *
 * La garde anti-écrasement (`settingsOpenRef` dans `useOverlayData`) reste
 * pilotée par `App` (`openJunimoEditor` / `goHome`, cf. leurs commentaires) :
 * elle empêche un poll de fond de re-render pendant que cette page est
 * ouverte. Pas de boucle d'auto-save, pour deux raisons : (1) le resync après
 * notre propre `onSaved()` recharge des valeurs identiques, donc les
 * `setShape`/`setColor`/etc. sont des no-op sur des primitives identiques ;
 * (2) l'effet de debounce ne dépend QUE des 4 valeurs éditées et appelle
 * `performSave` via une ref — le changement d'identité de `data` après un
 * refetch ne peut donc pas réarmer une sauvegarde à lui seul.
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

  // Forme : même pattern radiogroup à roving tabindex que l'accessoire
  // ci-dessous (tâche #46 — 6 formes ne tiennent plus dans le SegmentedControl
  // Astryx à 360px, même limitation que celle qui a fait basculer l'accessoire
  // sur cette grille en #26 : le composant hugue le contenu sur une seule
  // ligne sans variante "wrap"). On réutilise donc les classes
  // `junimo-chip-grid`/`junimo-chip` déjà validées pour l'accessoire.
  const shapeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onShapeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const current = JUNIMO_SHAPES.findIndex((s) => s.id === shape);
    if (current < 0) return;
    let next = current;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % JUNIMO_SHAPES.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + JUNIMO_SHAPES.length) % JUNIMO_SHAPES.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = JUNIMO_SHAPES.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setShape(JUNIMO_SHAPES[next].id);
    shapeRefs.current[next]?.focus();
  }

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

  // Minuteur de debounce (ré-armé à chaque modification) + chaîne de
  // sérialisation des sauvegardes (voir doc de la fonction ci-dessus).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Ignore le tout premier passage de l'effet de debounce (montage : les
  // valeurs initiales sont déjà celles de `data`, inutile de re-sauvegarder).
  const didMountRef = useRef(false);
  // Évite de mettre à jour l'état (feedback) après démontage de la page,
  // par ex. quand le clic sur « Retour » déclenche un flush juste avant de
  // quitter l'éditeur.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const buildSettings = useCallback((): AppSettings => {
    const trimmed = name.trim();
    return {
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
  }, [data.settings, shape, color, accessory, name]);

  // Effectue la sauvegarde tout de suite (pas de nouveau debounce). Chaînée
  // sur `saveChainRef` : si un `invoke` précédent est encore en vol, celui-ci
  // attend sa résolution avant de partir — les sauvegardes ne se chevauchent
  // jamais, même en cas de modifications rapprochées.
  const performSave = useCallback(() => {
    const settings = buildSettings();
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        if (!isTauri) {
          console.log("Junimo (dev, hors Tauri) : set_settings serait appele avec", settings);
        } else {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("set_settings", { settings });
        }
        if (isMountedRef.current) {
          setFeedback("enregistré ✓");
          setTimeout(() => {
            if (isMountedRef.current) setFeedback("");
          }, 2000);
        }
        onSaved();
      } catch (error) {
        console.error("Junimo: echec de set_settings (auto-save editeur)", error);
      }
    });
  }, [buildSettings, isTauri, onSaved]);

  // L'effet de debounce ci-dessous ne doit dépendre QUE des 4 valeurs
  // éditées : s'il dépendait de `performSave` (recréée à chaque nouveau
  // `data`, donc après notre propre `onSaved`), chaque sauvegarde réarmerait
  // la suivante 400 ms plus tard — boucle infinie save → refetch → save.
  // D'où cette ref, toujours pointée sur la dernière fermeture.
  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  // Flush : déclenche immédiatement le debounce EN ATTENTE — utilisé au blur
  // du champ nom et au clic sur « Retour », pour ne jamais perdre les 400
  // dernières ms de saisie en quittant vite. Sans minuteur en attente, il n'y
  // a rien de non sauvegardé : on ne renvoie pas un save redondant.
  const flushSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    performSaveRef.current();
  }, []);

  // Auto-save debouncé : toute modification de forme/couleur/accessoire/nom
  // réarme un minuteur de AUTOSAVE_DEBOUNCE_MS avant d'appeler performSave.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      performSaveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [shape, color, accessory, name]);

  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center">
          <Button
            label="Retour"
            variant="ghost"
            icon={<Icon icon="chevronLeft" />}
            onClick={() => {
              // Flush avant de quitter : garantit que la dernière
              // modification (notamment sur le champ nom) est bien envoyée,
              // sans attendre le debounce de AUTOSAVE_DEBOUNCE_MS.
              flushSave();
              onBack();
            }}
          />
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
              <div
                role="radiogroup"
                aria-label="Forme du junimo"
                className="junimo-chip-grid"
                onKeyDown={onShapeKeyDown}
              >
                {JUNIMO_SHAPES.map((s, i) => (
                  <button
                    key={s.id}
                    ref={(el) => {
                      shapeRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={shape === s.id}
                    tabIndex={shape === s.id ? 0 : -1}
                    className={shape === s.id ? "junimo-chip junimo-chip--selected" : "junimo-chip"}
                    onClick={() => setShape(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
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
              // Flush au blur (tâche #48) : n'attend pas les 400 ms du
              // debounce pour envoyer la dernière frappe si le focus quitte
              // le champ (tab, clic ailleurs, etc.).
              onBlur={flushSave}
            />

            {feedback ? (
              <HStack gap={2} align="center">
                <Text type="supporting">{feedback}</Text>
              </HStack>
            ) : null}
          </VStack>
        </Panel>
      </VStack>
    </div>
  );
}
