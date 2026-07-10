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
