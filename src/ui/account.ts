import type { Account } from "../types";
import { renderDegradedSection } from "./degraded";
import { escapeHtml, formatTokens } from "./format";

function renderRow(label: string, value: string): string {
  return `
    <div class="account-row">
      <span class="pixel-label account-label">${label}</span>
      <span class="mono account-value">${value}</span>
    </div>`;
}

export function renderAccountSection(account: Account | undefined, degraded: boolean): string {
  if (degraded || !account) {
    return renderDegradedSection("Compte", "account");
  }
  return `
    <section class="panel section" data-section="account">
      <div class="section-head">
        <h2 class="pixel-label section-title">Compte</h2>
      </div>
      <div class="account-grid">
        ${renderRow("Plan", `${escapeHtml(account.plan)} · ${escapeHtml(account.tier)}`)}
        ${renderRow("Email", escapeHtml(account.email))}
        ${renderRow("Org", escapeHtml(account.org))}
        ${renderRow("Modele", escapeHtml(account.default_model))}
        ${renderRow("CLI", escapeHtml(account.cli_version))}
        ${renderRow("Aujourd'hui", `${account.today_messages} msgs · ${formatTokens(account.today_tokens)} tok`)}
      </div>
    </section>`;
}
