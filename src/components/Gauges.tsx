import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import type { Gauge, Gauges as GaugesData } from "../types";
import {
  formatBlockReset,
  formatPercent,
  formatResetAt,
  formatTokens,
  formatWeeklyResetOfficial,
  gaugeLevel,
  type GaugeLevel,
} from "../ui/format";
import { Panel, DegradedSection } from "./Panel";

/** Type de fenêtre : le bloc 5h affiche une durée restante, les hebdos une date au-delà de 24h. */
type WindowKind = "block" | "weekly";

/** Mappe le niveau d'alerte (seuils inchangés, cf. format.ts) vers une variante Astryx. */
function levelVariant(level: GaugeLevel): "success" | "warning" | "error" {
  if (level === "red") return "error";
  if (level === "orange") return "warning";
  return "success";
}

function GaugeRow({
  label,
  gauge,
  windowKind,
  referenceIso,
  nowIso,
}: {
  label: string;
  gauge: Gauge;
  windowKind: WindowKind;
  referenceIso: string;
  nowIso: string;
}) {
  const level = gaugeLevel(gauge.percent);
  const variant = levelVariant(level);

  // Pied de jauge : mode officiel = reset officiel, plus un compteur de
  // tokens ESTIMÉS localement quand le backend a pu les fusionner (tâche
  // #31, marqué "≈ … (est.)" pour ne jamais les confondre avec un vrai
  // compteur officiel) ; mode estimé = compteur tokens + reset absolu
  // (comportement inchangé).
  const isOfficial = gauge.source === "official";
  const reset = isOfficial
    ? windowKind === "block"
      ? formatBlockReset(gauge.reset_at, nowIso)
      : formatWeeklyResetOfficial(gauge.reset_at, nowIso)
    : formatResetAt(gauge.reset_at, referenceIso);
  const usage = ((): string | null => {
    if (gauge.used_tokens === null || gauge.cap === null) return null;
    if (isOfficial) {
      return gauge.tokens_source === "estimated"
        ? `≈ ${formatTokens(gauge.used_tokens)} / ${formatTokens(gauge.cap)} tok (est.)`
        : null;
    }
    return `${formatTokens(gauge.used_tokens)} / ${formatTokens(gauge.cap)} tok`;
  })();

  return (
    <VStack gap={1}>
      <HStack justify="between" align="center">
        <Text type="supporting">{label}</Text>
        <Badge variant={variant} label={`${formatPercent(gauge.percent)}%`} />
      </HStack>
      <ProgressBar label={label} isLabelHidden value={gauge.percent} max={100} variant={variant} />
      <HStack justify="between" align="center">
        {usage ? <Text type="supporting">{usage}</Text> : <span />}
        <Text type="supporting">{reset}</Text>
      </HStack>
    </VStack>
  );
}

/**
 * Section « Jauges » : 3 jauges (Session (5h) / Weekly / Weekly Fable). Les
 * libellés, seuils de couleur et textes de pied sont inchangés (format.ts). Le
 * tag « estimé » ne dépend que de la source du bloc 5h (contrat backend).
 */
export function Gauges({
  gauges,
  degraded,
  referenceIso,
  nowIso,
}: {
  gauges: GaugesData | undefined;
  degraded: boolean;
  referenceIso: string;
  nowIso: string;
}) {
  if (degraded || !gauges) {
    return <DegradedSection title="Jauges" />;
  }
  const isEstimated = gauges.block_5h.source === "estimated";
  return (
    <Panel title="Jauges" action={isEstimated ? <Badge variant="neutral" label="estimé" /> : undefined}>
      <VStack gap={2}>
        <GaugeRow label="Session (5h)" gauge={gauges.block_5h} windowKind="block" referenceIso={referenceIso} nowIso={nowIso} />
        <GaugeRow label="Weekly" gauge={gauges.weekly} windowKind="weekly" referenceIso={referenceIso} nowIso={nowIso} />
        <GaugeRow label="Weekly Fable" gauge={gauges.weekly_fable} windowKind="weekly" referenceIso={referenceIso} nowIso={nowIso} />
      </VStack>
    </Panel>
  );
}
