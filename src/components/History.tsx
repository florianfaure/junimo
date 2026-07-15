import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import type { DayUsage } from "../types";
import { formatDayShort, formatTokens } from "../ui/format";
import { Panel } from "./Panel";
import { Num } from "./Num";

/** Hauteur max d'une barre en px. */
const BAR_MAX_PX = 40;
/** Hauteur minimale visible d'une barre non nulle. */
const BAR_MIN_PX = 2;

/**
 * Section « Historique » : mini bar-chart de la consommation quotidienne sur
 * 14 jours. La logique (max de période, journée max en orange, dernier jour
 * surligné, hauteurs) est identique au front vanilla. Le bar-chart n'est pas un
 * composant Astryx : il reste un rendu léger en flex + hauteurs inline.
 */
export function History({ history }: { history: DayUsage[] | undefined }) {
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
          // consommation, teinte orange saturée pour le pic (lisible dans les
          // deux modes), fin liseré sur la barre du jour courant.
          const color = isMax ? "var(--color-icon-orange)" : "var(--color-accent)";
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
