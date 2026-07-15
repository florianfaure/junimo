import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import type { Account as AccountData } from "../types";
import { formatTokens, resolvePlanDisplay } from "../ui/format";
import { Panel, DegradedSection } from "./Panel";
import { Num } from "./Num";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <HStack justify="between" align="center" gap={2}>
      <Text type="supporting">{label}</Text>
      {mono ? (
        <Num type="body" color="primary" maxLines={1} style={{ textAlign: "right", minWidth: 0 }}>
          {value}
        </Num>
      ) : (
        <Text type="body" maxLines={1} style={{ textAlign: "right", minWidth: 0 }}>
          {value}
        </Text>
      )}
    </HStack>
  );
}

/** Section « Compte » : infos du compte Claude (plan, email, org, modèle, CLI, conso du jour). */
export function Account({ account, degraded }: { account: AccountData | undefined; degraded: boolean }) {
  if (degraded || !account) {
    return <DegradedSection title="Compte" />;
  }
  return (
    <Panel title="Compte">
      <VStack gap={1}>
        <Row label="Plan" value={resolvePlanDisplay(account.plan, account.tier)} />
        <Row label="Email" value={account.email} />
        <Row label="Org" value={account.org} />
        <Row label="Modele" value={account.default_model} />
        <Row label="CLI" value={account.cli_version} mono />
        <Row label="Aujourd'hui" value={`${account.today_messages} msgs · ${formatTokens(account.today_tokens)} tok`} mono />
      </VStack>
    </Panel>
  );
}
