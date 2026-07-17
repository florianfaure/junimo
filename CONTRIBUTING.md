# Contributing to Junimo

Thanks for your interest in contributing! Junimo is a small, actively-developed menu bar
companion for your Claude account, built with Tauri v2 and React. This guide covers how to
set up the project locally and how the contribution process works.

## Development setup

**Prerequisites**

- macOS (the only supported platform today)
- [Node.js](https://nodejs.org/) >= 22.18
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)

**Getting started**

```bash
npm install
npm run tauri dev
```

This launches the full Tauri app (native shell + React frontend) with hot reload.

If you only need to work on the frontend in isolation (e.g. for UI/UX iteration without the
native shell), you can build it standalone:

```bash
npm run build
```

## Project governance: Roadmapped

This repository tracks its own project management as flat files using
[Roadmapped](https://github.com/5e1y/roadmapped) — tasks live as YAML under `docs/tasks/` and are driven by
the `npx roadmapped` CLI (see `CLAUDE.md` at the repo root for the maintainer workflow).

**This only applies to maintainers and AI agents working directly in the repo.** If you're an
external contributor:

- Do **not** hand-edit the YAML files under `docs/tasks/`, and do not run `npx roadmapped`
  write commands (`add`, `update`, `done`, etc.) against this repo.
- Use standard GitHub workflows instead: open an [issue](../../issues) to propose a change or
  report a bug, and submit a [pull request](../../pulls) for code changes. Maintainers will
  reconcile accepted contributions with the Roadmapped task board themselves.

## Commit conventions

Commits in this repo follow a `type(scope): description` format, for example:

```
feat(junimo): branchement du mood réel — snapshot/nowIso passés au Header (#49)
fix(header): dimensions explicites du svg engrenage dans IconButton (#44)
```

Common types include `feat`, `fix`, `chore`, `docs`, `refactor`, and `merge`. Existing history
is written in French by the maintainer, but **English is entirely welcome and preferred for
external contributions** — just keep the `type(scope): description` shape, and reference the
related issue or PR number when relevant.

## Pull request process

1. Fork the repository.
2. Create a branch off `main` for your change (`git checkout -b feat/my-change`).
3. Make your change, following the commit conventions above.
4. Open a pull request against `main` with a clear description of what changed and why.
5. Make sure CI is green before requesting review — pull requests with failing checks won't be
   merged.
6. Be responsive to review feedback. Small, focused PRs are easier to review and merge quickly.

## Code of conduct and security

- Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.
- Found a security issue? Do **not** open a public issue — see [SECURITY.md](SECURITY.md) for
  how to report it privately.

## Questions

Feel free to open a [discussion or issue](../../issues) if anything in this guide is unclear or
if you'd like feedback on an idea before investing time in a pull request.
