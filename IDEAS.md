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

## Manual VTXO selection / coin control

Let users choose which VTXOs fund a transaction. This is feasible, but should start narrowly.

Current shape:

- The app already has a VTXO inspection surface and a classified VTXO loader (`loadWalletVtxos` / `vtxo-listing.ts`).
- Send execution is centralized in store actions (`sendArkade`, `sendOnchain`, `sendChainSwap`, `sendAsset`, `sendLightning`) and routed through `executeSend`.
- Review already does fee previews for Bitcoin collaborative exits by loading VTXOs and estimating fees.
- The SDK exposes explicit VTXO selection for deprecated `sendBitcoin({ selectedVtxos })`, and lower-level settlement accepts explicit inputs. Plain `wallet.send(...)` does not expose selected inputs.

Recommended MVP:

- Support BTC-only spends first:
  - Arkade BTC address sends.
  - Bitcoin collaborative exits.
- Keep chain-swap selection as a follow-up after the direct BTC paths are reliable.
- Do not include asset sends or Lightning in the first cut. Asset-bearing VTXOs need careful asset-change handling; Lightning currently goes through the Boltz swap wrapper without an app-visible selected-input hook.
- Disable asset-bearing, spent, swept/recoverable, subdust, expired/pending-recovery, and otherwise non-spendable VTXOs in the selector for the MVP.

Ideal UI flow:

1. User enters destination and amount as today.
2. Review shows `VTXOs: Automatic` with a chevron.
3. Tapping opens a VTXO selector screen.
4. Selector lists eligible VTXOs with amount, status, age/expiry, and asset badges. Ineligible rows are visible but disabled with a reason.
5. Sticky footer shows selected total, estimated fee, change/shortfall, and a `Done` button.
6. Review updates to `Manual - N VTXOs` and recalculates fee/change.
7. Confirm re-fetches selected outpoints, validates they are still spendable, then submits. If a selected VTXO changed due to renewal or another spend, show a stale-selection error and return to Review.

Implementation notes:

- Store and route only outpoint refs (`txid:vout`), not full VTXO objects.
- Add a reusable resolver that re-fetches live VTXOs and maps selected outpoints to fresh SDK objects.
- Add selected-input fee estimation for collaborative exits instead of the current "all eligible VTXOs" estimate.
- For on-chain collaborative exit, replace `Ramps.offboard(...)` with explicit `wallet.settle({ inputs, outputs })` when manual selection is active.
- For Arkade BTC sends, wrap SDK `sendBitcoin({ selectedVtxos })` behind a local helper so the deprecated API is isolated.
- Reuse the existing VTXO list row visuals where possible, but keep the standalone VTXO list as an inspection surface; the selector should be a send-flow screen.

Effort:

- MVP: medium, roughly 4-7 engineering days including tests and manual device verification.
- Full support across assets, Lightning, and chain swaps: larger, likely 2-3 weeks and possibly SDK/package changes.

Main risks:

- The selected Arkade BTC path depends on a deprecated SDK method.
- Auto-renewal/background settlement can make a selection stale between Review and Confirm.
- Dust change and fee rules need clear UX: selected inputs can cover the amount but still leave unusable change.
- Accidentally spending asset-bearing VTXOs in BTC-only paths could mishandle or strand asset value; block this in MVP.

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
