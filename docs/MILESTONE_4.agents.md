# Milestone 4: Activity Details

Goal: make every Activity row inspectable. A user should be able to tap an
Activity and see the details that explain what happened, when it happened, and
which protocol identifiers are useful for verification or support.

The details page should be generic and metadata-driven. Do not build one
separate screen per Activity type. Render a common summary and then only the
sections whose fields are present.

This milestone should prove:

- Tapping an Activity row opens a details page for that Activity.
- The details page works for Arkade payments, boarding deposits, onchain
  Bitcoin events, Lightning swaps, VTXO renewals, settlement fallbacks, and
  asset activity.
- Every visible id, address, invoice, and hash can be copied.
- Explorer links are shown when a network and tx id make them possible.
- Activity details remain stable after app restart because important context is
  stored or enriched on the Activity row during wallet refresh.

## Current State

- `app/screens/ActivityScreen.tsx` renders `wallet.activities` in a `FlatList`.
- Activity rows are currently plain `View`s, not pressable rows.
- `app/navigation/RootStack.tsx` has an `Activity` route but no details route.
- `Activity.metadata` already exists as a generic record.
- Milestone 3 may already produce correct Activity rows and stable ids without
  carrying every field needed by a details page. Milestone 4 owns filling that
  gap.

## Product Rules

- The details page is an inspection/support surface, not a separate transaction
  manager.
- Display human-readable labels first; keep protocol fields precise and
  copyable.
- Do not show secrets casually. In particular, do not display Lightning
  preimages unless a later support/debug mode explicitly requires it.
- Do not make asset support a product surface in this milestone. Asset rows are
  inspectable because they happened, not because the wallet supports managing
  assets.
- If a field is absent, omit it. Do not show empty placeholders.
- If a row is ambiguous, say so plainly with the safest known facts instead of
  inventing a payment direction or peer address.

## Navigation

Add a stack route:

```ts
ActivityDetails: { activityId: string };
```

Make rows in `ActivityScreen` pressable and navigate with the Activity id:

```ts
nav.navigate("ActivityDetails", { activityId: item.id });
```

The details screen should read the current Activity from `useAppStore` via a
selector keyed by the route's `activityId`, **not** receive the Activity
object as a route param. Selecting from the store means an in-flight
`refreshWallet()` that enriches the row while the screen is open
re-renders automatically with the new metadata. Render a not-found state
if the selector returns nothing (the row was deleted, or the wallet was
reset). Distinguish the not-found state from an empty-metadata state: a
present row with sparse metadata still renders the Summary section.

Suggested file:

- `app/screens/ActivityDetailsScreen.tsx`

Header title:

- `"Activity details"` for the route title;
- show the Activity title inside the screen summary.

## Metadata Contract

Milestone 4 owns detail metadata enrichment. Assume Milestone 3 may already be
done and may only provide enough metadata for the Activity list itself.

The details screen should not perform expensive reconstruction from raw
SDK/indexer state while rendering. Instead, Milestone 4 should enrich Activity
rows during normal wallet refresh and swap merge paths, then render persisted
metadata immediately.

This means Milestone 4 may need to update:

- `app/services/arkade/activity-history.ts`, if introduced by Milestone 3;
- `app/services/arkade/swap-mappers.ts`;
- `app/services/arkade/swap-storage.ts`;
- send/receive flows that know addresses, invoices, fees, or destination
  context at the moment an Activity is created.

Existing activities should degrade gracefully. If old persisted rows lack a
field, omit that field from details until the next refresh can rebuild or enrich
it. Some details, such as an original Lightning invoice, may be unrecoverable if
they were not stored when the flow happened.

Recommended metadata keys:

Common:

- `createdAt`
- `confirmedAt`
- `settledAt`
- `statusReason`
- `feeSats`
- `network`
- `explorerUrl`

Identifiers:

- `arkTxid`
- `commitmentTxid`
- `boardingTxid`
- `bitcoinTxid`
- `claimTxid`
- `refundTxid`
- `fundingTxid`
- `paymentHash`

Addresses:

- `boardingAddress` — our own boarding address, known from wallet metadata.
- `bitcoinAddress` — an onchain address resolved by the wallet itself (for
  example a collaborative-exit destination if the SDK exposes it). Do not
  invent peer addresses.
- `arkadeAddress` — our own Arkade address, known from wallet metadata.

Peer `sourceAddress` / `destinationAddress` for plain Arkade send and Arkade
receive are **not stored in M4**. The send flow knows the user-entered
destination, but Activities are derived from VTXOs at snapshot time and there
is no current path to attribute that string to a specific persisted Activity
row. Until the SDK exposes peer addresses on `ArkTransaction` or a dedicated
send-meta side table is added, omit peer addresses entirely rather than
guessing. Lightning peer details ride on `invoice` / `paymentHash`, not on
address fields.

Lightning:

- `invoice`
- `swapId`
- `swapType`
- `provider`
- `boltzApiUrl`
- `invoiceAmountSats`
- `arkadeAmountSats`
- `lightningFeeSats`
- `claimFeeSats`
- `refundFeeSats`
- `linkSource`

Renewal and settlement:

- `inputCount`
- `outputCount`
- `renewedAmountSats`
- `netDeltaSats`
- `unresolvedAmountSats`
- `settlementReason`
- `delegated`
- `automatic`

Assets (richer enrichment deferred — see below):

- `assetId`
- `assetAmount`
- `assetAmountBaseUnits`
- `assetName`
- `assetTicker`
- `assetDecimals`
- `assetSupply`
- `controlAssetId`
- `anchorAmountSats`

**M4 implementation scope:** display only the asset metadata that
`getActivityHistory` already produces today (`assetId`, `assetAmount`,
`anchorAmountSats`, `classification`). Richer fields (`assetName`,
`assetTicker`, `assetDecimals`, `assetSupply`, `assetAmountBaseUnits`,
`controlAssetId`) are documented here for the eventual asset-enrichment pass
but are **not implemented in M4**. The section builder must tolerate their
absence and render only the keys that are present. Do not introduce SDK
calls to fetch asset details during snapshot or during details rendering.

Only store values that are safe to persist in app state. Do not store private
keys, mnemonics, swap preimages, or other secrets in Activity metadata.

Keep `Activity.metadata` **flat**. Its declared shape in `app/store/types.ts`
is `Record<string, string | number | boolean | null>` and the persisted
AsyncStorage blob relies on that. Do not introduce nested objects, arrays, or
`bigint` values into metadata — flatten with key prefixes (for example
`assetTicker` not `asset.ticker`) so existing typing and persistence keep
holding.

## Enrichment Sources

Populate detail metadata where the information is naturally available.

Arkade Activity builder:

- add protocol ids while deriving rows: `arkTxid`, `commitmentTxid`,
  `boardingTxid`;
- add deterministic timestamps used by the row;
- add renewal/settlement counts and deltas;
- add asset metadata available from the SDK/indexer;
- add explorer ids, but leave explorer URL construction to a network-aware
  helper when possible.

Send and receive flows:

- capture fees returned by send flows when reliably available and stamp them
  onto the matching Activity by `arkTxid` during the next refresh;
- our own onchain/boarding/Arkade addresses are already in wallet metadata —
  no separate capture is needed.

Plain Arkade send peer addresses and Arkade receive peer addresses are not
captured in M4. Lightning swaps already capture invoice / `swapId` /
`paymentHash` via `swap-storage.ts` and `BoltzSwap`; see the Lightning swap
layer below.

Lightning swap layer:

Project — do not duplicate. The `BoltzSwap` repository already stores
`invoice`, `paymentHash`, `swapType`, `provider`, status, and the package's
own response fields. Build the metadata at **merge time** in
`app/services/arkade/swap-mappers.ts` by reading from the live `BoltzSwap`
plus `LocalSwapMetadata`:

- from `BoltzSwap`: `invoice`, `paymentHash`, `swapType`, `provider`,
  `swapId`, `boltzApiUrl`, `claimTxid` / `refundTxid` / `fundingTxid` and
  fee fields when the package surfaces them;
- from `LocalSwapMetadata` (`swap-storage.ts`): `linkSource`,
  `arkadeAmountSats`, `invoiceAmountSats`, `walletTxId`.

Do **not** migrate the `trixie_swap_meta` table to add columns the boltz
repo already owns — that's wasted persistence and a re-sync hazard. Only
extend `swap-storage.ts` for fields the boltz repo cannot give us
(linkage, originating flow, restore stamps — already covered today).

When projecting, **explicitly strip the preimage**. `BoltzReverseSwap`
exposes the preimage hex once a claim succeeds; it must never land in
`Activity.metadata`. Add a unit-style assertion in the mapper or a code
comment at the projection site so the rule survives refactors.

If a restored swap lacks local-only fields such as the originating flow or
linkage, show whatever the boltz repo provides and omit what's missing —
the renderer already drops absent keys.

Activity details should prefer persisted metadata over live lookups. Optional
live enrichment is allowed later, but it must be best-effort and must not block
the details page from rendering.

## Screen Shape

Use a restrained detail layout, not a marketing page.

Recommended sections:

1. Summary
2. Payment
3. Network
4. Identifiers
5. Addresses
6. Lightning
7. Asset
8. Technical

Render sections only when they have fields.

### Summary

Always show:

- Activity title;
- status;
- timestamp;
- amount or event label;
- rail;
- direction, when meaningful.

For `direction: "self"` or `"none"`, avoid debit/credit signs.

### Payment

Show when amount fields exist:

- displayed amount in the selected Bitcoin unit;
- raw sats;
- fee if known;
- net delta if known;
- anchor amount only as a technical field for assets, not as the primary amount.

### Network

Show:

- rail: Arkade, Bitcoin, Lightning;
- network name;
- confirmation/settlement state;
- explorer buttons when available.

### Identifiers

Show copyable rows for:

- Arkade txid;
- commitment txid;
- boarding txid;
- Bitcoin txid;
- claim/refund/funding txids;
- payment hash;
- asset id;
- control asset id.

Use labels that explain what the id is. Do not expose raw ids without context.

### Addresses

Show copyable rows for addresses the wallet itself owns or resolved:

- boarding address, when the row is a boarding deposit (this is our own
  receiving boarding address);
- Arkade address, when the row is an inbound receive against our own Arkade
  address;
- Bitcoin address, only when the SDK exposes a resolved onchain peer or the
  wallet captured it itself.

Peer source/destination addresses for plain Arkade send and Arkade receive are
**not displayed** in M4 — the wallet has no reliable retrieval path. If the
SDK later exposes peer addresses on `ArkTransaction`, or a dedicated send-meta
side table is introduced, they can be added without breaking the section
contract: render only the keys that exist.

### Lightning

Show:

- BOLT11 invoice;
- Boltz swap id;
- swap type;
- payment hash;
- provider;
- Boltz API URL, if useful for support;
- invoice amount and Arkade amount;
- Lightning, claim, or refund fees if known;
- link source when the Activity was matched to an Arkade tx.

The invoice should be copyable and displayed in a wrapped/truncated block that
does not break mobile layout.

### Renewal And Settlement

Show:

- commitment txid;
- renewed amount;
- input/output VTXO counts;
- net delta for mixed commitment rows;
- unresolved amount for `"Arkade settlement"` fallback rows;
- whether renewal was automatic, delegated, or manual if that can be inferred
  or stored.

For ambiguous settlement fallback rows, explain only what is known:

- the commitment id;
- that boarding/renewal/fresh receive value could not be fully separated with
  current SDK inputs;
- the unresolved amount.

`activity-history.ts` emits a raw enum into `metadata.reason`
(`"boarding_mixed_unresolved"` | `"asset_bearing_settlement"`). Keep the enum
in metadata and translate it to user-facing copy inside
`buildActivityDetailSections` — copy belongs near rendering, not near the
builder. The `"empty_group"` reason is filtered out at emit time
(`activity-history.ts`); no fixture or detail-renderer branch is needed for
it.

### Assets

Show only what current metadata provides:

- asset id (truncated, copyable);
- raw asset amount;
- anchor Arkade txid;
- anchor sats as technical anchor value;
- classification label (issued / burned / sent / received / activity).

Name, ticker, decimals, formatted asset amount, supply, and control asset id
are part of the eventual asset-enrichment pass and are **not rendered in M4**
because they are not available in metadata yet. The section is forward-
compatible: when the enrichment pass lands and starts populating those keys,
the renderer should pick them up without further section changes.

Do not fetch or display remote icons until asset icon trust/approval rules are
added. A generic icon or text label is enough.

### Technical

Use a collapsed or visually secondary section for raw metadata:

- Activity id;
- Activity kind;
- source type;
- raw status;
- raw metadata fields not already rendered.

The raw section is useful for support but should not dominate the page.

## Copy And Links

Every copyable value should have a small copy button and success toast.

Use existing app conventions:

- `ToastProvider` for copy feedback;
- `lucide-react-native` icons only;
- `expo-clipboard` if it is already available, or add it intentionally if not.

Explorer links are valuable. Use a small network-aware helper rather than
hard-coded URLs sprinkled inside the details screen.

- Arkade offchain (`arkTxid`, `commitmentTxid`, `boardingTxid` — boarding txids
  are also indexed by the Arkade explorer):
  - mainnet → `https://arkade.space`
  - mutinynet → `https://explorer.mutinynet.arkade.sh`
  - signet, regtest, and other networks have no public Arkade explorer — show
    the id without a link.
- Bitcoin onchain (`bitcoinTxid`, `claimTxid`, `refundTxid`, `fundingTxid`,
  and `boardingTxid` when the user wants to inspect the underlying Bitcoin
  transaction): use a public Bitcoin explorer (e.g. mempool.space variants),
  selected by network. Do **not** reuse the wallet's `esploraUrl` — that is
  the indexer URL, not a human-facing explorer.

If the helper cannot build a reliable URL for an id on the active network,
show the id without a link rather than synthesising a guess. The helper
should be a pure `(id, kind, network) => string | null` so the section
builder can call it without React-Native imports.

## Implementation Notes

- Keep details rendering pure where possible: transform an `Activity` into
  labeled sections, then render those sections.
- Add small helpers such as `buildActivityDetailSections(activity, prefs)`.
- Keep row dimensions stable and text wrapping deliberate; invoices and txids
  must not overflow on mobile.
- The Activity list should remain fast. Do not fetch remote detail data while
  rendering the list.
- If the details screen later fetches optional enrichment, it must show the
  persisted metadata immediately and treat enrichment as best-effort.
- Standardise copyable rows behind a single shared component, e.g.
  `app/components/CopyableField.tsx`, with props `{ label: string; value:
  string; mono?: boolean; multiline?: boolean; explorerUrl?: string | null }`.
  Every section should render copyable values through this component so that
  copy-button styling, truncation, the success toast (`useToast`), and
  optional explorer-link affordance stay consistent across the eight sections
  rather than drifting per-screen.

## Implementation Phasing

Land in phases so each one ships independently. Every phase ends in a state
where `pnpm check` passes and the app still runs.

### Phase 1 — Route + pressable rows + not-found state

- Add `ActivityDetails: { activityId: string }` to `RootStackParamList` in
  `app/navigation/RootStack.tsx` and register the screen.
- Wrap the row body in `app/screens/ActivityScreen.tsx` with a `Pressable`
  that calls `nav.navigate("ActivityDetails", { activityId: item.id })`.
- Create `app/screens/ActivityDetailsScreen.tsx` with the store-selector
  lookup and a not-found state. Render only the Summary section against
  current metadata.

After Phase 1: tapping any row opens a minimal but correct details view.

### Phase 2 — Pure section builder

- Add `app/services/activity-details/buildActivityDetailSections.ts` (or a
  similar module) exporting `buildActivityDetailSections(activity, prefs):
  Section[]`.
- Implement Summary, Payment, Network, Identifiers, Renewal/Settlement, and
  Technical sections against metadata that already exists.
- Translate the `metadata.reason` enum to user-facing copy here.
- Add a `<CopyableField>` component (see Implementation Notes) and wire it
  into the screen.

After Phase 2: details screen renders all already-emitted M3 metadata
correctly, with copy and an explorer-link helper for Arkade and Bitcoin
ids.

### Phase 3 — Lightning projection

- Update `app/services/arkade/swap-mappers.ts` to project Lightning
  metadata from `BoltzSwap` + `LocalSwapMetadata` at merge time. Strip
  preimages explicitly.
- The Lightning section in `buildActivityDetailSections` lights up.

After Phase 3: Lightning rows are inspectable end-to-end without changing
the swap-storage schema.

### Phase 4 — Arkade-history enrichment

- In `app/services/arkade/activity-history.ts`, stamp `network` onto every
  emitted Activity (thread it through from `runtime.ts:snapshotWallet`).
- Add explicit `arkTxid` / `commitmentTxid` / `boardingTxid` / `inputCount`
  / `outputCount` / `renewedAmountSats` / `netDeltaSats` /
  `unresolvedAmountSats` / `settlementReason` entries where the builder
  already has them but is not yet writing them.
- Confirm renewal rows render without an amount in the row UI but with a
  full breakdown in details.

### Phase 5 — Send-flow fee capture

- **Lightning send/receive:** computed at projection time in
  `swap-mappers.ts` from `arkadeAmountSats` vs. `invoiceAmountSats`
  (positive difference). No SDK change or side table needed; populates
  `metadata.lightningFeeSats` for both reverse and submarine swaps.
- **Plain Arkade send:** `Wallet.send(...)` returns only the txid, so a
  reliable per-tx fee is not available without an SDK change or a
  pre/post-send balance diff. **Deferred to a follow-up** rather than
  introducing a side table in M4. When an SDK helper exposes per-tx fees,
  stamp `metadata.feeSats` on the matching `arkade:offchain:${arkTxid}`
  row during the same refresh that surfaced it.
- Addresses are not captured (see Metadata Contract > Addresses).

### Phase 6 — Asset enrichment (deferred)

- Document but do not implement. Track as a follow-up that needs an SDK
  helper for `AssetDetails` and a trust/approval policy for icons.

After all phases: every Activity emitted today by `getActivityHistory` and
`mergeActivities` is inspectable, with explorer links where possible and
no leaked secrets.

## Testing Notes

> Jest is now wired up; see [docs/TESTING.md](./TESTING.md). The fixture
> list below is preserved as the M4 historical record — the detail-view
> section builders it describes are still untested at the time of
> writing, so the cases remain a useful starting point if/when that
> module gets a suite.

Minimum fixture cases:

- Arkade received with ark tx id;
- Arkade sent with `arkTxid` and known `feeSats`, no peer address (peer
  destination is intentionally unrendered in M4);
- boarding deposit with `boardingTxid` and our boarding address;
- Bitcoin/onchain event with explorer tx link;
- Lightning receive with invoice, swap id, payment hash, and claim tx;
- Lightning send with invoice, swap id, funding tx;
- Lightning **refund** (submarine `swap.refunded === true`) — direction flips
  to `"in"`, title reads `"Lightning refund"`, refund tx id is rendered;
- Lightning **unlinked** row (no `walletTxId`) — identifiers section still
  renders cleanly and the row is not deduped against any Arkade row;
- VTXO renewal with commitment id and input/output counts;
- mixed settlement with net delta (`renewal_plus_receive`);
- mixed settlement with negative delta (`renewal_plus_exit`) — both renewal
  and exit rows render distinctly;
- ambiguous `"Arkade settlement"` fallback (`reason:
  "boarding_mixed_unresolved"`);
- ambiguous `"Arkade settlement"` fallback (`reason:
  "asset_bearing_settlement"`);
- asset issued with the metadata `getActivityHistory` produces today
  (`assetId`, `assetAmount`, `anchorAmountSats`, `classification`);
- asset row whose `assetId` is the only metadata available — falls back to
  truncated asset id, no name/ticker;
- missing Activity id renders a not-found state.
