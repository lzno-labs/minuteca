# minuteca recorder for iOS

SwiftUI app for iOS 17 or newer, licensed under [MPL-2.0](LICENSE) (the rest of the repository is AGPL-3.0-only).

It only records, pauses, lists and uploads. Transcription, speaker names, search, export and sharing live in the web app, which also opens on the iPhone.

- `MinutecaKit/`: pure logic (recording states, segment rules, the recordings list, API requests, sign-in link parsing). Foundation only; `swift test` runs on macOS and Linux.
- `Minuteca/`: the app. Segmented recording with AVAudioRecorder that keeps going with the screen locked, in another app and after a call; background uploads; sign-in by email link; Face ID lock.
- Design: [`docs/design/ios-background-recording.md`](../docs/design/ios-background-recording.md). Sign-in: [`docs/adr/0003-access.md`](../docs/adr/0003-access.md).
- Visible text: `Minuteca/Resources/<lang>.lproj/` (Spanish is the development language). `npm run lint` checks that every key the app uses exists in every language.

## Build

```sh
brew install xcodegen
cd ios && xcodegen          # generates Minuteca.xcodeproj (not committed)
open Minuteca.xcodeproj
```

To run on your iPhone, create `Config/Signing.xcconfig` (ignored by git) with your Apple team, a bundle id of yours and your server:

```
DEVELOPMENT_TEAM = ABCDE12345
MINUTECA_BUNDLE_ID = com.yourname.minuteca
MINUTECA_SERVER_URL = https:/$()/minuteca.yourdomain.org
```

## What to try on a real iPhone

The simulator cannot lock the screen with a running microphone or take phone calls, so check these on a device:

1. Record 30 minutes with the screen locked, then stop: the list shows about 30 minutes and the web plays all of it.
2. While recording, receive a call and hang up: the status goes to "Interrumpida" and back to "Grabando" on its own; the audio before and after the call is there.
3. While recording, switch to another app for a few minutes and come back.
4. Stop a recording in airplane mode: it shows "Sin señal". Turn airplane mode off: it uploads without opening anything.
5. Force quit the app while recording, open it again: the recording appears as recovered and uploads (at most the last 2 minutes are lost).
