import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * Un onglet de la navigation : identifiant stable, libellé, icône optionnelle
 * (SVG monochrome fourni par l'appelant) et contenu affiché quand l'onglet est
 * actif. Interface figée : partagée avec les tâches voisines (#43, #44) et la
 * page Réglages (#5 / tabs Compte-Réglages).
 */
export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

/**
 * Navigation en onglets réutilisable, style monochrome dense (thème T3/#41).
 * L'onglet actif est souligné par un liseré `--color-accent` (le gris
 * d'action) ; les inactifs restent en texte secondaire — aucune couleur hors
 * palette. Le composant est contrôlé : `active` + `onChange` pilotent l'onglet
 * courant depuis l'extérieur (persistance côté hook, cf. useOverlayData).
 *
 * Accessibilité : role tablist/tab/tabpanel, liaison aria-controls/labelledby,
 * roving tabindex (seul l'onglet actif est tabbable) et navigation clavier aux
 * flèches (activation automatique, + Home/End).
 */
export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  // Références aux boutons d'onglet pour déplacer le focus à la navigation
  // clavier (roving tabindex).
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Index de l'onglet actif (repli sur le premier si `active` ne correspond à
  // aucun item — état incohérent transitoire).
  const activeIndex = items.findIndex((item) => item.id === active);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;

  // Active et focus l'onglet à l'index donné (bouclage circulaire).
  function focusTab(index: number) {
    const target = items[(index + items.length) % items.length];
    onChange(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(currentIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(items.length - 1);
        break;
    }
  }

  const activeItem = items[currentIndex];

  return (
    <div className="tabs">
      <div className="tabs-list" role="tablist" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === activeItem?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              className={`tabs-tab${selected ? " tabs-tab--selected" : ""}`}
              onClick={() => onChange(item.id)}
              ref={(el) => {
                if (el) tabRefs.current.set(item.id, el);
                else tabRefs.current.delete(item.id);
              }}
            >
              {item.icon ? (
                <span className="tabs-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div
          role="tabpanel"
          id={`tabpanel-${activeItem.id}`}
          aria-labelledby={`tab-${activeItem.id}`}
          className="tabs-panel"
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
