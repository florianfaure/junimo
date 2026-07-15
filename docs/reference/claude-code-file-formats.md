# Formats de fichiers Claude Code observés (non documentés)

Les fichiers que Junimo lit ne sont **pas documentés par Anthropic** et
peuvent changer sans préavis à chaque montée de version du CLI. Ce document
recense les champs réellement consommés par le collecteur, pour pouvoir les
re-vérifier rapidement.

## Signal automatique

À chaque snapshot, Junimo compare `claude --version` à la dernière version
vue (mémorisée dans `junimo-state.json`, dossier de config de l'app). En cas
de changement, `meta.degraded` porte une entrée `cli_version_changed:<old>-><new>`
— c'est le signal de dérouler la check-list ci-dessous.

## Check-list à chaque montée de version

1. `~/.claude.json` — vérifier la présence et la forme de :
   - `oauthAccount` : `displayName`, `emailAddress`, `organizationName`,
     `organizationType`, `userRateLimitTier`, `billingType`,
     `subscriptionCreatedAt` (tous optionnels côté collecteur).
   - `mcpServers.<name>` : `type` (stdio/http/sse), `url` (transports distants).
   - `projects.<path>.mcpServers` : même forme, scope projet.
2. `~/.claude/settings.json` — `model` (modèle par défaut).
3. `~/.claude/projects/**/*.jsonl` — sur une ligne de type assistant :
   - `timestamp` (RFC3339), `requestId` ;
   - `message.id`, `message.model` ;
   - `message.usage` : `input_tokens`, `output_tokens`,
     `cache_creation_input_tokens`, `cache_read_input_tokens`.
4. Lancer `cargo test` (fixtures `src-tauri/tests/fixtures/`) puis les smoke
   tests manuels : `cargo test -- --ignored` (lecture seule du vrai home).
5. Comparer un snapshot réel à `/usage` (ordre de grandeur des jauges).

Consommateurs dans le code : `src-tauri/src/collector/config.rs`
(`.claude.json`, `settings.json`), `src-tauri/src/collector/transcripts.rs`
(JSONL). Toute divergence se manifeste par des entrées `meta.degraded`
(`claude_json_invalid`, `transcripts_parse_errors:N`, …) — le collecteur ne
crashe jamais sur un format inattendu.

## Credentials OAuth de Claude Code (2026-07-15)

Junimo récupère les credentials OAuth de Claude Code (accessToken, refreshToken,
expiresAt) en lecture seule, sans jamais les rafraîchir. Les sources sont
(dans l'ordre de préférence) :

1. **Keychain macOS** — `security find-generic-password -s "Claude Code-credentials" -w`
   retourne un JSON UTF-8 : 
   ```json
   {
     "claudeAiOauth": {
       "accessToken": "sk-...",
       "refreshToken": "ref-...",
       "expiresAt": 1721097600000,
       "userEmail": "...",
       "organizationId": "...",
       "organizationName": "..."
     }
   }
   ```
   Les champs `userEmail`, `organizationId`, `organizationName` et autres sont
   optionnels pour Junimo.

2. **Repli fichier** — `~/.claude/.credentials.json` (même structure JSON).

## Endpoint `usage` non documenté (2026-07-15)

Junimo appelle `GET https://api.anthropic.com/api/oauth/usage` pour récupérer
les limites officielles du compte Claude.

**Headers requis** :
- `Authorization: Bearer <accessToken>`
- `anthropic-beta: oauth-2025-04-20`

**Schéma de la réponse observée** (2026-07-15) — **non documenté et susceptible
de changer sans préavis** :

```json
{
  "limits": [
    {
      "kind": "session",
      "percent": 45,
      "is_active": true,
      "resets_at": null,
      "scope": {...}
    },
    {
      "kind": "weekly_all",
      "percent": 78,
      "is_active": true,
      "resets_at": "2026-07-20T00:00:00Z",
      "scope": {...}
    },
    {
      "kind": "weekly_scoped",
      "percent": 62,
      "is_active": true,
      "resets_at": "2026-07-20T00:00:00Z",
      "scope": {...}
    }
  ],
  "five_hour": {
    "utilization": 45,
    "resets_at": null
  },
  "seven_day": {
    "utilization": 78,
    "resets_at": "2026-07-20T00:00:00Z"
  },
  "seven_day_opus": null,
  ...autres champs ignorés...
}
```

**Champs consommés par Junimo** :
- `limits[].kind` : "session", "weekly_all" ou "weekly_scoped"
- `limits[].percent` : utilisation 0-100
- `limits[].resets_at` : ISO8601 ou null (aucune session en cours pour 5h)
- `limits[].is_active` : boolean (limite active ou expirée)
- `limits[].scope` : objet scope (ignoré par Junimo, structure variable)
- `five_hour.utilization`, `five_hour.resets_at` : legacy
- `seven_day.utilization`, `seven_day.resets_at` : legacy
- `seven_day_opus` : nullable legacy
- Tous autres champs : ignorés

**Avertissement** : cet endpoint n'est pas documenté par Anthropic et peut
changer à chaque montée de version de Claude Code. En cas d'erreur API, Junimo
replie automatiquement sur l'estimation locale depuis les fichiers JSONL
(`src-tauri/src/collector/transcripts.rs`), ce qui assure une dégradation
gracieuse.
