# Contributing to minuteca

Thanks for helping. Issues and pull requests are welcome in English or Spanish.

## Sign your commits (DCO)

minuteca uses the [Developer Certificate of Origin](https://developercertificate.org/), not a CLA. Every commit must end with a `Signed-off-by:` line matching the commit author, which certifies you wrote the change or have the right to submit it under the project's licenses:

```sh
git commit -s -m "Fix speaker colors in dark mode"
```

CI rejects pull requests with unsigned commits. To fix the last commit: `git commit --amend -s --no-edit`; for several: `git rebase --signoff main`.

## Licenses of what you contribute

- Changes outside `ios/` are licensed under AGPL-3.0-only.
- Changes inside `ios/` are licensed under MPL-2.0 (see `ios/LICENSE`). Keep the `SPDX-License-Identifier: MPL-2.0` header in new Swift files.

## Before opening a pull request

```sh
npm ci && npm run lint && npm test && npm run build
swift test --package-path ios/MinutecaKit
```

- User-facing text never goes in code: add it to `locales/es.json` and every other `locales/<lang>.json` (web and emails) or `ios/Minuteca/Resources/<lang>.lproj/Localizable.strings` (iOS), in Spanish first.
- Dates, numbers and amounts are formatted by region, amounts always with their currency.
- A new transcription provider is a new adapter in `src/server/transcriber/` that returns minuteca's transcript format ([ADR 0002](docs/adr/0002-transcripts-and-providers.md)). Every AI call goes through `startTranscription()` in `src/server/transcription.ts`, which checks permission, meters minutes and enforces caps.
- Nothing about a person leaves towards an AI service without their explicit permission, and the app says where it goes before it leaves.
- Read the ADRs in `docs/adr/` before changing architecture. A change that contradicts one comes with a new ADR that supersedes it.
- A feature of more than a day, or one that touches personal data, security, money or AI, starts with a short design in `docs/design/`.
- Keep pull requests small and focused, with tests.

Security issues: never in a public issue. See [SECURITY.md](SECURITY.md).
