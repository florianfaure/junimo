# Security Policy

## Scope

Junimo is a menu bar companion app for your Claude account. By design, it reads your Claude
Code data (files under `~/.claude`) **locally and strictly read-only**, and the only network
calls it makes are:

- a request to **Anthropic's own usage endpoint** (`api.anthropic.com`), authenticated with
  the Claude Code credentials already stored on your machine (read read-only — never
  refreshed, modified, or logged), and
- the **optional MCP health check**, which pings the MCP servers you yourself configured.

There is no telemetry and no third-party service. If you discover behavior that contradicts
this — any code path that sends local data (transcript contents, `~/.claude` files, account
details) to any other destination, or that writes to or modifies your credentials — that is a
**major vulnerability** and should be reported immediately using the process below.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Publicly disclosing
a vulnerability before it's fixed can put users at risk.

Instead, report it privately by emailing:

**naybe.design@gmail.com**

Please include as much detail as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce it (proof-of-concept code or commands are appreciated)
- The version/commit of Junimo affected
- Your macOS version and any other relevant environment details

## What to expect

- **Acknowledgement**: we will acknowledge receipt of your report within **72 hours**.
- **Assessment**: we will investigate and aim to keep you updated on progress as we work
  toward a fix.
- **Disclosure**: once a fix is available, we will coordinate with you on an appropriate
  disclosure timeline. We're happy to credit reporters who wish to be acknowledged, unless you
  prefer to remain anonymous.

## Supported versions

Junimo does not yet follow a formal versioned release/support policy. Security reports are
evaluated against the latest code on the `main` branch.

Thank you for helping keep Junimo and its users safe.
