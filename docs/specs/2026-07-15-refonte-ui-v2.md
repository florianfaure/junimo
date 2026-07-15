# Junimo v2 — refonte UI Astryx, éditeur de junimo, jauges enrichies

**Date** : 2026-07-15 · **Statut** : en attente de validation par Florian (brainstorming du 2026-07-15)

## Contexte et objectif

La v1 est fonctionnelle (23 tâches, jauges officielles branchées) mais l'UI est intégralement pixel-art Stardew. Objectif v2 : une UI **clean/tech** construite sur un vrai design system — [Astryx de Meta](https://astryx.atmeta.com/) (open source, juin 2026, React + StyleX, 150+ composants, thèmes par tokens, dark mode, CLI + serveur MCP lisible par les agents) — où le **pixel art est réservé au junimo**, qui devient la mascotte personnalisable de l'app (inspiration : Blume, Figma figpal). S'y ajoutent une navigation multi-pages (Réglages/Compte, éditeur du junimo), des jauges enrichies et l'ouverture de l'overlay même au-dessus d'une app fullscreen.

Exécution : Fable orchestre, un subagent frais par tâche (Haiku pour la mécanique bien spécifiée, Sonnet pour l'intégration, Opus pour l'architecture et le visuel exigeant), review avant `done` pour les tâches M/L. Chaque chantier = une tâche Roadmapped distincte (visibilité complète côté Florian).

## Décisions structurantes (et alternatives écartées)

| Décision | Choix | Alternatives écartées |
|---|---|---|
| Design system | **Migration React + Astryx** (composants officiels, thème par tokens, dark mode, a11y ; le serveur MCP Astryx guide les agents) | Tokens Astryx seuls en vanilla TS (recoder les composants à la main, pas d'écosystème) ; Preact/Solid + look Astryx (pas les composants officiels) |
| Frontend | **React + StyleX** — révise la décision v1 « React inutile pour un seul écran » : la v2 est multi-pages (accueil, réglages, éditeur) avec état partagé | Rester vanilla : le rendu innerHTML-total devient intenable avec navigation + accordions + éditeur live |
| Assets junimo | **Recolorisation + calques** : un sprite de base propre par forme, palette swap programmatique (canvas), accessoires en sprites séparés superposés — combinatoire extensible | Sprites dessinés par variante (production lourde, peu extensible) ; SVG génératif (rupture avec les PNG, sur-ingénierie) |
| Navigation | **Une page « Réglages » combinée** (réglages + compte), icône en haut à gauche, bouton retour ; éditeur junimo sur sa propre page via clic sur le junimo | Deux pages distinctes Réglages / Compte (deux icônes, navigation plus lourde pour peu de contenu) |
| Tokens sur jauges | **% officiel + tokens estimés** : la jauge garde le pourcentage `/usage`, le compteur de tokens vient de l'estimation locale, marqué « est. » (l'API officielle ne renvoie jamais de compteurs) | Tokens seulement en mode estimation (l'info demandée disparaît dans le mode nominal) |
| Fullscreen | **NSPanel non-activant** + `collectionBehavior` (`canJoinAllSpaces` \| `fullScreenAuxiliary`) pour que l'overlay s'affiche au-dessus des Spaces fullscreen | Laisser le comportement NSWindow actuel (l'overlay force la sortie du fullscreen ou n'apparaît pas) |
| Branche | Effort mené sur une branche `ui-v2`, merge à la fin (suite complète verte exigée) | Commits directs sur main (interdit pour un effort multi-commits) |

## Direction visuelle

- **Clean/tech d'abord** : thème Astryx sobre (base `neutral`, accents personnalisés), typographie du DS, mono pour les données, dark mode natif. Fini le parchemin, les bordures 9-slice et la police Press Start 2P sur les titres.
- **Pixel art = le junimo uniquement** : sprite `image-rendering: pixelated` dans une UI par ailleurs nette — le contraste fait le charme (cf. figpal dans l'UI Figma).
- Le sous-titre « tableau de bord Claude Code » disparaît. Le header porte le junimo + son **nom personnalisé** (défaut : « Junimo »).
- L'icône tray (template monochrome) ne change pas.

## Chantiers

### 1. Fondation React + Astryx
Migration du shell front : plugin React pour Vite, StyleX, install Astryx via son CLI, versions épinglées, compat webview Tauri vérifiée. Re-rendu **iso-fonctionnel** des sections existantes (jauges, historique, projets, MCPs, compte, réglages) avec les composants Astryx bruts — le polish visuel vient au chantier 2. Le contrat `Snapshot` Rust ne bouge pas.

### 2. Thème et refonte visuelle clean/tech
Thème Astryx custom (tokens couleur/typo/radius/motion), dark mode, layout de l'accueil, suppression du sous-titre et du thème pixel global. Livrable jugé sur captures avant/après.

### 3. Navigation interne + page Réglages/Compte
Routing interne léger (état de page : `home` / `settings` / `junimo-editor`), icône en haut à gauche, page Réglages regroupant le footer réglages actuel + la section Compte, bouton retour systématique.

### 4. Accordions MCPs & Projets
Sections MCPs et Projets repliables (composant disclosure/accordion Astryx), état ouvert/fermé persisté dans les réglages locaux.

### 5. Jauges — renommage
`Bloc 5h` → **Session (5h)**, `7j global` → **Weekly**, `7j Fable/Opus` → **Weekly Fable**.

### 6. Jauges — heure de reset sur Weekly et Weekly Fable
`resets_at` officiel est déjà disponible : afficher date **et heure locale** de reset sur les deux jauges hebdo (aujourd'hui l'heure est omise au-delà de 24 h).

### 7. Jauges — compteurs de tokens en mode officiel
Côté Rust : en mode officiel, calculer aussi l'estimation locale et exposer `used_tokens`/`cap` estimés dans le `Gauge` (champ marquant la source). Côté front : `≈ X / Y tok (est.)` à côté du % officiel. Tests Rust sur le merge des deux sources.

### 8. Assets junimo — base propre + recolor + accessoires
Redessiner le sprite de base en pixel art propre (2-3 **formes**), encoder la palette de référence pour un **palette swap** canvas (couleurs), produire les **accessoires** en calques PNG alignés (chapeau, lunettes, nœud…). Livrable : module TS framework-agnostic `composeJunimo({forme, couleur, accessoire}) → canvas/dataURL` + les assets. Testable hors React.

### 9. Éditeur de junimo
Page dédiée (clic sur le junimo → éditeur, bouton retour) : choix forme / couleur / accessoire avec préview live + champ nom. Persistance dans `junimo-settings.json` (mécanisme réglages existant). Le nom s'affiche dans le header.

### 10. Ouverture tray au-dessus du fullscreen
L'overlay devient un NSPanel non-activant avec `collectionBehavior: canJoinAllSpaces | fullScreenAuxiliary` (crate `tauri-nspanel` ou `objc2` direct). Critère : icône tray cliquée pendant qu'une app est fullscreen → l'overlay apparaît par-dessus, sans changer de Space, et le blur-close continue de fonctionner.

### 11. Vérification de bout en bout v2
Comme #10 en v1 : suite complète verte, parcours réel (accueil → réglages → retour, édition junimo persistée après relance, jauges, fullscreen), captures. Gate du merge `ui-v2` → main.

## Ordre et dépendances

```
(5)(6) renommage + heure reset ──────────────┐        [quicks, faisables tout de suite en vanilla]
(1) Fondation React+Astryx ──┬─ (2) Thème/refonte ────┬─ (11) Vérif E2E
                             ├─ (3) Navigation ─┬─ (9) Éditeur junimo ─┤
                             ├─ (4) Accordions ─┘                      │
                             └─ (7) Tokens jauges (front) ─────────────┤
(8) Assets junimo ───────────────────────────── (9)                   │
(10) Fullscreen NSPanel ───────────────────────────────────────────────┘
```

(5), (6), (8), (10) sont sans dépendance — front de départ parallèle avec (1). (7) a sa moitié Rust indépendante mais son affichage passe par le front migré.

## Dispatch multi-agents

| Tâche | Modèle | Pourquoi |
|---|---|---|
| 1 Fondation React+Astryx | **Opus** | Architecture, choix d'intégration Vite/StyleX/Tauri |
| 2 Thème/refonte visuelle | **Opus** | Qualité visuelle = le cœur de la demande |
| 3 Navigation | **Sonnet** | Intégration standard |
| 4 Accordions | **Haiku** | Mécanique bien spécifiée, composant DS existant |
| 5 Renommage jauges | **Haiku** | Trivial |
| 6 Heure de reset | **Haiku** | Formatteur existant à étendre |
| 7 Tokens estimés | **Sonnet** | Contrat Rust + tests |
| 8 Assets junimo | **Opus** | Pixel art propre + module de composition |
| 9 Éditeur junimo | **Sonnet** | Intégration UI + persistance |
| 10 Fullscreen NSPanel | **Opus** | macOS bas niveau, pièges nombreux |
| 11 Vérif E2E | **Fable** (orchestrateur) | La preuve finale se vérifie soi-même |

## Hors scope v2

- Recoloration de l'icône tray selon le junimo personnalisé (reste template monochrome).
- Animations avancées du junimo (réactions, déplacements type figpal) — candidate v3.
- Toute distribution signée (#18, déjà au backlog).
