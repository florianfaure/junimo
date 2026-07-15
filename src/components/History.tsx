import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import type { ChatStat, DayUsage } from "../types";
import { formatDayShort, formatDurationBetween, formatRelativeAgo, formatTokens } from "../ui/format";
import { Panel } from "./Panel";
import { Num } from "./Num";

/** Hauteur max d'une barre en px. */
const BAR_MAX_PX = 40;
/** Hauteur minimale visible d'une barre non nulle. */
const BAR_MIN_PX = 2;

/**
 * Une ligne de conversation : projet, modèle dominant, tokens pondérés,
 * durée (début -> dernière activité) et ancienneté de la dernière activité.
 * Pur affichage : la durée est calculée ici via `formatDurationBetween`
 * (mise en forme, pas de logique métier — le statut en_cours/terminée, lui,
 * est décidé côté backend, voir `types.ts::ChatStat`).
 */
function ChatRow({ chat, referenceIso }: { chat: ChatStat; referenceIso: string }) {
  return (
    <HStack gap={2} align="center">
      <Text type="body" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
        {chat.project}
      </Text>
      <Badge variant="neutral" label={chat.model} />
      <Num>{formatTokens(chat.tokens)} tok</Num>
      <Num>{formatDurationBetween(chat.started_at, chat.last_used)}</Num>
      <Num>{formatRelativeAgo(chat.last_used, referenceIso)}</Num>
    </HStack>
  );
}

/** Sous-groupe (en cours ou terminées) : libellé + compte, puis les lignes. */
function ChatGroup({
  label,
  variant,
  chats,
  referenceIso,
}: {
  label: string;
  variant: "success" | "neutral";
  chats: ChatStat[];
  referenceIso: string;
}) {
  if (chats.length === 0) return null;
  return (
    <VStack gap={1}>
      <HStack gap={2} align="center">
        <Badge variant={variant} label={label} />
        <Text type="supporting" size="2xs">{chats.length}</Text>
      </HStack>
      <VStack gap={1}>
        {chats.map((chat) => (
          <ChatRow key={chat.id} chat={chat} referenceIso={referenceIso} />
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * Section « Conversations » : distingue les conversations en cours des
 * conversations terminées (tâche #43), chacune avec projet, modèle, tokens
 * et durée. Le statut en_cours/terminée vient déjà décidé du backend
 * (`collector::snapshot::chat_stats`, seuil d'inactivité — Claude Code
 * n'expose aucun évènement natif de fin de chat) : aucune logique de seuil
 * ici, uniquement du tri par statut pour l'affichage.
 */
function ConversationsSection({ chats, referenceIso }: { chats: ChatStat[] | undefined; referenceIso: string }) {
  if (!chats || chats.length === 0) {
    return (
      <Panel title="Conversations">
        <Text type="supporting">aucune conversation récente</Text>
      </Panel>
    );
  }

  const inProgress = chats.filter((chat) => chat.status === "in_progress");
  const done = chats.filter((chat) => chat.status === "done");

  return (
    <Panel title="Conversations" action={<Badge variant="neutral" label={String(chats.length)} />}>
      <VStack gap={3}>
        <ChatGroup label="en cours" variant="success" chats={inProgress} referenceIso={referenceIso} />
        <ChatGroup label="terminées" variant="neutral" chats={done} referenceIso={referenceIso} />
      </VStack>
    </Panel>
  );
}

/**
 * Section « Historique » : mini bar-chart de la consommation quotidienne sur
 * 14 jours. La logique (max de période, journée max en orange, dernier jour
 * surligné, hauteurs) est identique au front vanilla. Le bar-chart n'est pas un
 * composant Astryx : il reste un rendu léger en flex + hauteurs inline.
 */
function DailyHistoryPanel({ history }: { history: DayUsage[] | undefined }) {
  if (!history || history.length === 0) {
    return (
      <Panel title="Historique">
        <Text type="supporting">pas d'historique</Text>
      </Panel>
    );
  }

  const maxTokens = history.reduce((max, day) => Math.max(max, day.tokens), 0);
  const maxIndex = maxTokens > 0 ? history.findIndex((day) => day.tokens === maxTokens) : -1;
  const lastIndex = history.length - 1;
  const firstLabel = formatDayShort(history[0].date);

  return (
    <Panel title="Historique" action={<Badge variant="neutral" label="14j" />}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: BAR_MAX_PX + 8 }}>
        {history.map((day, i) => {
          let heightPx = 0;
          if (day.tokens > 0) {
            const ratio = maxTokens > 0 ? day.tokens / maxTokens : 0;
            heightPx = Math.max(BAR_MIN_PX, Math.round(ratio * BAR_MAX_PX));
          }
          const isMax = i === maxIndex;
          const isToday = i === lastIndex;
          // Barres retokenisées sur le thème Astryx (fix review #25 : plus de
          // vars inexistantes ni de repli hex). Accent de marque pour la
          // consommation, teinte orange saturée pour le pic (fix #26 :
          // --color-icon-orange est un token catégoriel pensé pour du *texte*
          // sur fond pastel — dark T30 marron en light, T80 clair en dark. En
          // aplat plein sur toute la hauteur d'une barre, le light vire brun
          // boueux illisible (bug constaté sur les captures QA). Aucun token
          // "orange" du thème n'expose d'aplat saturé en light : le système
          // catégoriel est volontairement pastel-bg + texte-foncé de ce côté
          // (jamais fill franc). --color-chart-peak (styles.css) retint donc
          // le light sur un orange franc du même axe chromatique H≈55, tout
          // en gardant --color-icon-orange en dark, déjà correct.
          const color = isMax ? "var(--color-chart-peak)" : "var(--color-accent)";
          return (
            <div
              key={day.date}
              title={`${formatDayShort(day.date)} · ${formatTokens(day.tokens)} tok`}
              style={{
                flex: 1,
                height: heightPx,
                background: color,
                borderRadius: "var(--radius-none)",
                outline: isToday ? "1px solid var(--color-text-primary)" : undefined,
              }}
            />
          );
        })}
      </div>
      <HStack justify="between">
        <Num size="2xs">{firstLabel}</Num>
        <Text type="supporting" size="2xs">aujourd'hui</Text>
      </HStack>
    </Panel>
  );
}

/**
 * Tab « Chats » (tâche #43) : conversations en cours/terminées d'abord (le
 * contenu le plus actionnable), puis le mini bar-chart de consommation
 * quotidienne existant (tâche #28), conservé tel quel en dessous.
 */
export function History({
  history,
  chats,
  referenceIso,
}: {
  history: DayUsage[] | undefined;
  chats: ChatStat[] | undefined;
  referenceIso: string;
}) {
  return (
    <VStack gap={2}>
      <ConversationsSection chats={chats} referenceIso={referenceIso} />
      <DailyHistoryPanel history={history} />
    </VStack>
  );
}
