# ADR-0006: Desktop releases and updates on GitHub

- **Status:** Accepted; Mac updates superseded by ADR-0008
- **Date:** 2026-11-11
- **Supersedes:** ADR-0005, distribution only (the rest of ADR-0005 stands)
- **Author:** founding agent (claude)

## Context

ADR-0005 had people download the desktop app from their minuteca server (`/descargar`). Updates were not covered. The owner wants the app to update itself, or at least a button in the app to update, so nobody downloads installers again. Most of the app is the web, which already updates with each deploy. The window and the engine are what need updates. The core repo was private, so GitHub could not serve files to people without access. The owner then chose to make it public, as `AGENTS.md` expects of every core.

## Options

1. **Our own bucket behind the server** (`/api/desktop/*`, R2). This works with a private repo. It adds a bucket, a binding and a publishing workflow with a Cloudflare token.
2. **GitHub Releases of the public core.** It is free, needs no extra infrastructure and is supported directly by electron-updater. Public repos also get GitHub-hosted runners for free, including macOS.

## Decision

Option 2.

- The `desktop` workflow builds on GitHub-hosted runners with no secrets. Given a version, it publishes the release `v<version>` with the DMGs and ZIPs for Mac (Apple and Intel), the Windows installer, the blockmaps and the feeds (`latest.yml`, `latest-mac.yml`).
- Installer names stay the same across versions, so `/descargar` links to `releases/latest/download/<name>`.
- The app reads the releases at start and every 6 hours (electron-updater, `publish: github`).
  - **Windows:** downloads the update in the background and asks to restart.
  - **Mac:** macOS refuses to update ad hoc signed apps. Until the app carries a Developer ID signature, it announces the version and opens the download page.
- Settings shows the version and "Buscar actualizaciones". The Mac app menu has the same check.

## Consequences

- Self-hosters get the same releases; their app still shows their own server.
- Signing later: a Developer ID build runs from the private repo with its secrets, and uploads to the core's release with a token that can write releases. SignPath can sign Windows builds for free now that the core is public.
- If GitHub ever stops being a good home, ADR-0005's bucket design is the fallback. Moving would mean a new ADR.
