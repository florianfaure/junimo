# Junimo goes open source — lancement sur GitHub public

**Date** : 2026-07-17 · **Statut** : approuvée (design validé en session, 4 arbitrages AskUserQuestion)

## Contexte

Junimo (menu bar companion Tauri pour le compte Claude, esthétique Stardew Valley) vit
uniquement en local : aucun remote git, 130 commits, ni README ni LICENSE. Objectifs de la
publication : (1) rendre le produit open source, (2) obtenir la gouvernance multi-devices —
`docs/tasks/` (Roadmapped) étant tracké, un clone + `npx roadmapped dashboard` suffit sur
n'importe quelle machine.

## Décisions (et alternatives écartées)

| Sujet | Décision | Écarté |
|---|---|---|
| Destination | `github.com/florianfaure/junimo`, public, via gh CLI (compte authentifié, scopes repo+workflow) | Compte 5e1y (auth à basculer) ; org dédiée (lourd pour un mainteneur seul) |
| Historique | Conservé intégralement **après scan secrets sur les 130 commits** (gate bloquante) | Squash en commit initial (perd la traçabilité publique) ; push sans scan (risqué) |
| Licence | MIT (`LICENSE` racine + champs package.json / Cargo.toml) | — |
| IP Stardew Valley | Nom « Junimo » conservé + disclaimer fan-art « unofficial, not affiliated with ConcernedApe » dans le README + audit confirmant que les assets sont des créations originales des scripts du repo | Renommage du produit |
| Langue | README et docs publiques en anglais ; docs internes (tasks, specs, CLAUDE.md) restent en français | README.fr.md (à la demande plus tard) |
| package.json | `"private": true` conservé (empêche un npm publish accidentel ; l'app n'est pas un package npm) | — |
| Périmètre | Pack OSS complet : README, MIT, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates GitHub, CI build, workflow release | Minimal (README+MIT) ; standard sans CI |

## Périmètre — 11 tâches en 4 vagues

**Vague 1 — Assainissement (gate bloquante avant tout push)**
1. Scan secrets sur tout l'historique (gitleaks + revue manuelle) — sonnet, engineering.
2. Assainir les chemins personnels `/Users/florianfaure/...` dans les fichiers trackés
   (collector Rust, tauri.conf.json, mock.ts, scripts, YAMLs de tâches) — sonnet, engineering.
3. Audit des assets : créations originales des scripts (`gen_assets.py`, `gen_tray_icon.ts`),
   aucun sprite extrait du jeu — sonnet, design.

**Vague 2 — Contenu OSS (parallélisable)**
4. README.md anglais : pitch, screenshots, install, architecture, disclaimer ConcernedApe — opus, design.
5. LICENSE MIT + champs license/repository/author dans package.json et Cargo.toml — haiku, engineering.
6. CONTRIBUTING.md + CODE_OF_CONDUCT.md + SECURITY.md — sonnet, engineering.
7. Templates GitHub (.github/ : issues bug/feature, PR template) — haiku, engineering.

**Vague 3 — CI/CD (parallélisable avec la vague 2)**
8. CI GitHub Actions : typecheck + build front + cargo test sur macos-latest (PR/push) — sonnet, engineering.
9. Workflow release : tag `v*` → build .dmg non signé attaché à une GitHub Release
   (la signature/notarisation reste la tâche #18, liée) — sonnet, engineering.

**Vague 4 — Publication (séquentielle, orchestrateur)**
10. Création repo + push + config (description, topics, About). **GO explicite de Florian
    requis juste avant le push** (l'historique devient public, irréversible) — operations.
11. Vérification post-publication : clone frais, `npm install && npm run build`, liens README,
    CI verte — sonnet, engineering.

Dépendances : 10 dépend de 1–9 ; 11 dépend de 10. Aucune dépendance intra-vague.

## Hors périmètre

- Signature/notarisation macOS (tâche #18 existante, indépendante).
- Publication npm, support Windows/Linux, site vitrine, annonce publique (Reddit/HN/X).
- Réécriture d'historique (sauf si le scan de la vague 1 révèle un secret — escalade à Florian).

## Orchestration

Une tâche Roadmapped par chantier (epic `opensource-launch`), taguée `opensource` + modèle
(`haiku`/`sonnet`/`opus`). Un subagent frais par tâche, briefé par `npx roadmapped brief <id>`
+ cette spec. Un seul implémenteur à la fois par working tree ; les audits read-only peuvent
tourner en parallèle dans le même tree. Review par agent frais avant `done` pour les tâches
M/L. Clôtures (`done`) et merges par l'orchestrateur. Aucune commande interactive en subagent.

## Critères de done du lancement

- Le scan secrets est vert (ou l'incident a été traité et re-scanné).
- `github.com/florianfaure/junimo` est public, CI verte sur main, README rendu correctement.
- Un clone frais build sans référence à des chemins personnels.
- Les 11 tâches sont `done` dans Roadmapped avec outcome + verification.
