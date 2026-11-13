# ADR-0008: The Mac app updates itself before it has a Developer ID

- **Status:** Accepted
- **Date:** 2026-11-12
- **Supersedes:** ADR-0006, Mac updates only (the rest of ADR-0006 stands)
- **Author:** founding agent (claude)

## Context

ADR-0006 publishes the desktop app on GitHub Releases with update feeds. Windows updates itself. The Mac app carries an ad hoc signature, and macOS's updater (Squirrel.Mac, used by electron-updater) refuses to install a bundle without a Developer ID signature, so the Mac app only announced new versions and opened the download page. The owner asked for updates without downloading a new DMG. Signing with a Developer ID is still pending as an owner decision (`DECISIONES.md`, "Firma de minuteca para Mac"): it needs the owner's Apple account, a certificate and secrets.

## Options

1. **Wait for the Developer ID.** Standard, and it also removes the first-launch "Open Anyway" step, but it depends on the owner's time.
2. **The app replaces itself.** It downloads the release's ZIP for its chip, checks it and swaps its own bundle when it quits.
3. **Keep the download page.** No work, but every update is a manual download and install.

## Decision

Option 2, until the app has a Developer ID; then builds with `MINUTECA_MAC_SIGNED=1` use Squirrel again and this path turns off by itself.

- **When it runs:** only when the app runs from a folder it can write (usually Applications), and never from the disk image or a translocated copy. Otherwise it keeps the download link.
- **Download and checks:**
  - The archive comes from `github.com/lzno-labs/minuteca/releases/download/v<version>/minuteca-mac-<arm64|x64>.zip`, and only plain version numbers and these fixed names are accepted.
  - Its SHA-512 must match `latest-mac.yml`, read from the same release over HTTPS.
  - It is unpacked with `ditto` next to the app (same disk) and must pass `codesign --verify --deep`.
  - The trust is the same as the person's own download of the DMG.
- **The swap:** a small script, detached, waits for the app to end, moves the old bundle aside and the new one into place, and puts the old one back if the move fails. It then reopens the app when the person chose "Reiniciar y actualizar". The paths reach the script through its environment, never pasted into it.
- **When it happens:** the person sees the same "lista: reiniciar" prompt as on Windows; quitting the app also installs it.

## Consequences

- Mac and Windows behave alike: the version downloads in the background and goes in on restart.
- The first install still needs "Open Anyway" once, until the Developer ID; updates do not ask again, because files the app downloads carry no quarantine flag.
- This code is ours to keep working across macOS versions; the Developer ID removes the need for it.
- Revisit when the owner decides on the Developer ID signature.
