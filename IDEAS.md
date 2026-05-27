# UI/UX ideas


## PWA migration analysis

Store gate-keeping on native apps conflicts with the project's distribution principles, so a PWA target is worth exploring. This should be treated as adding a web target beside native first, not as a straight replacement.

Current state:

- The app is explicitly native-only today: Expo SDK 55 / React Native 0.83, iOS and Android only.
- The UI is probably portable with React Native Web work, but the wallet runtime is not a build-flag flip.
- Native-only seams currently include:
  - Expo Arkade providers in `app/services/arkade/runtime.ts`.
  - SQLite persistence via `expo-sqlite` in `app/services/arkade/storage.ts`.
  - wallet secrets in `expo-secure-store` in `app/services/arkade/secret-store.ts`.
  - Expo background tasks, local notifications, and headless swap polling in `app/services/arkade/swap-background.ts`.
  - camera QR scanning, clipboard, file backup/export/import, sharing, haptics, and biometric unlock.

Promising SDK facts:

- `@arkade-os/sdk` already ships browser-oriented primitives: `RestArkProvider`, `RestIndexerProvider`, `IndexedDBWalletRepository`, `IndexedDBContractRepository`, and `ServiceWorkerWallet`.
- `@arkade-os/boltz-swap` ships `IndexedDbSwapRepository`.
- This suggests an adapter split is viable: native adapters keep using Expo/SQLite/SecureStore/background-task, web adapters use browser providers, IndexedDB, Web Crypto / credential-gated secret handling, and browser file APIs.

Estimated difficulty:

- PWA shell that opens and navigates: a few days.
- Foreground-only real wallet PWA: 1-2 focused weeks.
- PWA with a self-custody security posture worth shipping: 3-6 weeks.
- Full native parity is unlikely because browser background execution is weaker than Expo/iOS/Android native background tasks.

Important product constraint:

- Browser background work is not equivalent to native background tasks. Periodic Background Sync is limited/experimental and browser-scheduled. iOS Web Push works for Home Screen web apps, but it is notification-oriented rather than a reliable silent wallet maintenance loop.
- A realistic PWA should be foreground-first: users open it to sync, claim, refund, and refresh. Native can remain the stronger target for background swap maintenance.

Recommended path:

- Add a web target beside native.
- Introduce platform adapters (`.native.ts` / `.web.ts`) around storage, secrets, Arkade providers, swap repository, QR/file/clipboard, notifications, and background behavior.
- Start with a foreground-only PWA and intentionally disable or degrade background swap polling on web.
- Treat web secret storage and service worker update/caching behavior as first-class security design, not implementation details.

## Random ideas
 - how do passkeys map to our wallet? useful? used already? ../wallet has them on the roadmap 
 - NFC to send/receive? 
 	- Bluetooth, ... ?
 - recovery tools
 	- stranded VTXOs - spend from expired VHTLC ?
 	- broken VTXOs/contracts - how to renew/spend ?
 - budgeting, analytics?
 - investments?
 - FIAT integration?
 	- we DO NOT manage cards or FIAT payments, always lean on a 3rd party to buy BTC seamlessly and get them in the wallet via Arkade or Lightning
 		- what's the appetite for an Arkade-based BTC exchange? ie: buy 30 euros worth of BTC via Arkade, get them immediately
