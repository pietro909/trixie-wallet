# Milestone 17 Plan Review

Review of `docs/MILESTONE_17.agents.md` — strategies questioned, gaps and
ambiguities flagged. Grouped by severity (high → low). Each finding tags the
relevant section of the plan or the source file it touches.

## A. Unresolved decisions / "either-or" hand-waves (need to commit)

1. **Operation gate shape unspecified** — §2 says:
   *"`activeWalletOperations: Record<string, { kind: string; walletId: string }>`
   **or** an equivalent refcount keyed by opaque token."* This decides
   downstream behavior: a `Record` lets you track concurrent operation kinds
   for debugging and lets `setWalletBehavior` distinguish itself from
   `sendArkade`; a refcount can't. Pick one.

2. **Operation gate semantics: mutex vs counter** — Related to #1: the test
   bullet *"`switchWallet` while foreground gate is busy throws"* implies
   *any* operation blocks switching, but it's unclear whether two concurrent
   foreground actions (e.g. parallel `refreshWallet()` and `importAsset()`)
   are allowed or serialized. The current code already runs `refreshWallet()`
   re-entrantly via `refreshInFlight`/`refreshPending`
   (`app/store/useAppStore.ts:1140-1193`). If the gate is a mutex, that
   pattern breaks. If it's a refcount, switch needs `count === 0`.

3. **`PAYLOAD_VERSION` bump is conditional** — §7: *"bump `PAYLOAD_VERSION`
   to `3` **if** `LocalSwapMetadata.direction` / `createdForFlow` become
   nullable."* Batch 3 explicitly makes them nullable ("Direction / flow /
   amount / linkage fields may be nullable…"), so the bump is required, not
   optional. Remove the "if".

4. **`refreshServer()` scope** — §1: *"becomes profile-targeted **or**
   active-profile-only."* The picker needs per-profile probe state for the
   "server error badge" listed in §10, which argues for profile-targeted.
   Either commit to that or remove the picker badge.

## B. Concrete sequencing problems

5. **`rememberSwapBackgroundWallet` is called inside `ensureLightning`
   *before* setup succeeds today** — `app/services/arkade/lightning.ts:194`
   writes `ACTIVE_WALLET_KEY` immediately, *then* line 195 calls
   `ExpoArkadeSwaps.setup(...)`. §4 says *"Write `ACTIVE_WALLET_KEY` only
   after the profile has been committed active and Lightning setup for that
   profile has succeeded."* That's a real behavioral inversion (background
   target → store decides, not service decides), but it's not called out as
   a code-move. The plan must say explicitly: pull
   `rememberSwapBackgroundWallet` out of `ensureLightning` and call it from
   the store after the switch/create/import has atomically committed.

6. **Background task is registered at module top with non-scoped
   repository/identity** — `app/services/arkade/swap-background.ts:327-331`
   calls `defineExpoSwapBackgroundTask(...)` at module load with
   `swapRepository: createSwapRepository()` and a closure `identityFactory`.
   The OS runs this top-level handler in a headless JS context, so the
   "task context" the plan introduces (`withActiveSwapTaskContext`) has to
   wrap **what the package's task body invokes**, not what the app calls.
   §4 acknowledges this with *"If the package API does not expose a clean
   task-execution wrapper, emulate this with a short-lived module-level
   `activeTaskContext`…"* — but the emulation requires the package's
   handler to call `swapRepository`/`identityFactory` lazily and only after
   the wrapper has run. Without knowing the package's invocation order, the
   active-scoped repo could be called before context is set, causing
   fail-closed every time. This needs a concrete check against the
   `@arkade-os/boltz-swap` API, not a TBD.

7. **`switchWallet` re-entrancy** — §5 steps 1-12 don't describe what guards
   against a second `switchWallet(c)` starting after the first
   `switchWallet(b)` has cleared the operation gate check but before
   step 10 commits. The `walletSwitch` transient state is introduced for
   UI, but the plan doesn't say switch checks it as a re-entry guard. Add:
   *"if `walletSwitch != null`, throw or queue."*

8. **`activeWalletId = null` window during switch** — After step 7 (dispose)
   and before step 10 (commit), `activeWalletId` is still the *prior* id.
   Then if probe fails and prior rebuild fails (last branch of failure
   handling), the store flips to `null`. Any subscriber selecting
   `useActiveWallet()` will see `prior → null → null` — but `RootTabs` is
   keyed by `activeWalletId` (§10), so when it remounts on `null`, the
   navigator must already be on `WalletPicker`. The plan describes routing
   to picker at step 12 of the flow (and §10 says "set `activeWalletId =
   null` and route to WalletPicker") but doesn't sequence the route reset
   relative to the `set()` that flips active id to `null`. Specify: route
   reset must be dispatched synchronously with the store flip, not
   afterwards, to avoid a one-frame mount of `Main` with `activeWalletId
   === null`.

9. **Resume-in-flight outliving the switch** — §2 says *"only reuse the
   promise when both wallet id and generation match; clear it on runtime
   teardown"*. Clearing the *reference* doesn't cancel the in-flight
   HTTP/SQL work. Per §3, the scoped swap repo is bound at construction to
   a specific wallet id, so the old promise can still write to profile A's
   swap rows after the user has switched to B. The plan says A's writes-to-
   A are fine (durable), but this contradicts §3's "active-only swap
   management" rule that *"the app must not claim, refund, restore, or
   refresh swaps for a dormant profile under the active profile's wallet
   context."* Technically the work is *still* under A's context (scoped
   repo), not B's — but A is now dormant. Clarify whether this is
   acceptable or needs hard cancellation.

10. **Schema-mismatch wipe enumeration** — §8 says full reset *"clears every
    `ark_{walletId}_*` SDK repo for every stored profile"* by iterating
    `wallets[]`. But `acknowledgeSchemaMismatchAndWipe()` runs **before**
    the store could parse `wallets[]` (that's why it's the mismatch path).
    For a v6 → v7 upgrade, the v6 payload has one `wallet`, so the wipe
    can read that — but the plan codifies a `wallets[]` enumeration that
    won't apply at the mismatch boundary. Either spell out the v6-compat
    path explicitly or require the wipe to be prefix-scan based (scan
    `ark_*` keys via AsyncStorage `getAllKeys`, scan SecureStore keys,
    etc.). Implied "share an internal helper" doesn't resolve it.

## C. Spec gaps

11. **Atomicity of step 10's "persist once" is in-memory only** — Zustand
    `set()` is sync; AsyncStorage `setItem` is not transactional. A crash
    mid-write leaves a corrupt blob and hits the schema-mismatch wipe path
    on next boot, losing all profiles. This is the same risk as today, but
    with N profiles in one blob, blast radius is larger. Either accept the
    risk and call it out, or document a write-temp-then-rename pattern
    (AsyncStorage doesn't support that on RN; would need SQLite or
    filesystem).

12. **`getPendingSwapCountForWallet` over minimal ownership rows** — §3
    introduces "minimal ownership rows" claimed *before* projection
    details exist. §6 then uses `getPendingSwapCountForWallet` for both
    pending-swap warnings and the picker's "Monitoring paused" badge. Does
    a brand-new minimal row count as "non-terminal"? If so, an in-flight
    create on profile A could surface a misleading count on the picker the
    instant before its projection writes. Specify the count's join
    condition: terminal-status filter on `boltz_swaps`, not just ownership
    existence.

13. **Picker N+1 queries** — §10 calls `getPendingSwapCountForWallet(walletId)`
    per dormant row. For N profiles, that's N SQL round-trips. The plan
    should either bound this (one aggregate query `GROUP BY wallet_id`) or
    accept it as N small queries. For 2-5 wallets, fine; for 20, jarring.

14. **`ProfileReset: { walletId }` route param is suspicious** — §10 routes
    `ProfileReset` with `{ walletId: string }`, but §8 says active-profile
    reset is the only path and the screen *re-checks* `activeWalletId ===
    capturedWalletId` on submit. Why parameterize? If the route is hit
    from anywhere other than Profile → Reset active wallet, it's a bug.
    Remove the param or document the second caller.

15. **`AddWalletRestoreBackupPassword: { envelope: EncryptedEnvelope }`** —
    React Navigation serializes route params to JSON for state persistence
    (and warns/strips functions, Dates, etc.). The plan should require
    `EncryptedEnvelope` to be plain-JSON, or route via store state instead
    of a param.

16. **`identityKind` ↔ `secret.kind` matching** — §7 says import
    *"validates `payload.wallet.identityKind` matches `payload.secret.kind`."*
    `WalletIdentityKind = "mnemonic" | "singleKey"`
    (`app/store/types.ts:56`) but the secret store's `kind` is likely
    `"mnemonic" | "privateKey"` (or similar). The plan needs to define
    which side normalizes, or the validator will reject legitimately
    matching backups.

17. **Backup payload `arkServerUrl` derived from network mapping** — §7
    says import *"ignores the saved `wallet.arkServerUrl` except for
    diagnostics."* This is a real product decision: self-hosted Ark
    setups using a non-default URL won't survive a round-trip
    backup/restore. It belongs in §"Product Rules", not buried in import
    validation. Probably correct (so the network mapping stays
    canonical), but call it out so a user with a custom server doesn't
    lose it silently.

18. **Lightning-unsupported networks during switch** — §5 step 9 calls
    `maybeEnsureLightning(...)`. If the target's network is
    Lightning-unsupported, the "Resuming swaps..." stage of the overlay
    (§5) doesn't apply. Plan should either say *"the 'Resuming swaps'
    stage is skipped when Lightning is unsupported"* or remove it from
    the visible stage list. Currently silent.

19. **`importBackup` has no overlay** — §7 step 2 enters the operation
    gate and disposes the active runtime (step 5), but the plan never
    describes an import-time blocking overlay equivalent to
    `walletSwitch`. Either reuse the switch overlay (with import stages)
    or specify an import overlay; otherwise the user sees the
    WalletPicker / Add Wallet route mid-async without a stage indicator.

20. **`asset-metadata` shared by network** — §9 keeps
    `trixie:asset-metadata:${network}` shared across same-network
    profiles. But asset metadata is fetched via the wallet's Esplora
    endpoint (if it varies per profile, e.g. one profile points to a
    custom Esplora). Two profiles on `bitcoin` with different
    `esploraUrl` values would mix cached metadata. Low risk — Esplora
    overrides are unusual — but the §"Network is intrinsic to the
    profile" rule implies endpoints can differ.

21. **`tx-cache.ts` "globally unique" assumption** — §9: *"Ark txids are
    treated as globally unique."* Across **networks**? Ark txids are
    32-byte hashes — universally unique in practice, but the assumption
    deserves a one-line rationale ("Ark txids are 256-bit hashes;
    cross-profile collisions are astronomically unlikely") so a future
    reader doesn't introduce a profile-keyed override that breaks reuse.

## D. Smaller / editorial

22. **`LightningResumeTrigger` change is buried** — §1 expands
    `LightningResumeTrigger` to add `"switch"`, but the union is also
    referenced in §11 ("startup | unlock | foreground | switch"). The
    types.ts source value is `"startup" | "unlock" | "foreground"`
    (`app/store/types.ts:67`). One central type definition; one bump.
    Worth pulling into the data-model summary at the top.

23. **`AppState.schemaVersion = 7` literal in the type** — §1 shows
    `type AppState = { schemaVersion: 7; … }`. Today's source uses a
    literal `6` (`app/store/types.ts:186`). That's fine if hydrate
    matches on the constant. But the wipe-vs-load gate looks at
    `parsed.schemaVersion` directly
    (`app/store/useAppStore.ts:850-855`), so the *only* place `7`
    matters is the literal. Worth noting that the constant
    `CURRENT_SCHEMA_VERSION` in `useAppStore.ts:151` also needs bumping
    (the plan says this, but the redundancy means two synchronized
    literals — flag it).

24. **`useActiveWalletBehavior` selector seems redundant** — §1 adds
    `useActiveWalletBehavior()` next to `useActiveWallet()`. The behavior
    is just a field on the profile; consumers can
    `useActiveWallet()?.behavior`. Unless the selector exists to avoid
    full-profile re-render churn, drop it; if it exists for that reason,
    say so.

25. **Manual verification step 1 (v6 wipe)** — see #10. The doc asserts
    existing v6 installs hit the modal and wipe. With M17's new wipe
    codepaths assuming multi-profile shape, ensure the v6 case is
    explicitly tested, not assumed.

26. **`fullReset` blocked by foreground gate** — §8 says *"the full reset
    entry / button should still be disabled while the foreground
    operation gate is busy."* But it also says *"Full reset does not
    enter the normal wallet operation gate as a wallet action, but its
    UI is disabled while this gate is busy."* This is fine for UI but
    doesn't guard against e.g. a notification or deeplink dispatching
    `fullReset()` programmatically. Either gate it in the action too, or
    document why action-level guard isn't needed.

27. **Resume drop-on-stale: where do counters end up?** — §4's
    `RecordedSwapTaskResult` carries `walletId/network/...`. If a result
    for A arrives while B is active, it goes into the shadow log and
    surfaces when A reopens. Fine. But what about **notifications**? §4
    says *"Notification decisions are still made at result-write time,
    but notifications must use the captured wallet id for metrics /
    retention."* Does that mean A's swap completion sends a push
    notification even though B is foregrounded? Plan should resolve:
    notify on background poll regardless of foreground active profile
    (notification carries A's label), or suppress notifications for
    non-active profiles. Either is defensible; the plan doesn't pick.

## E. Strategic question worth flagging

28. **The plan never explains why multi-profile is being layered on a
    single-runtime architecture instead of just preserving the M16
    model + a "restore-and-switch" workflow.** The motivation block
    says "demo / testing ergonomics" — but the plan introduces ~10 new
    persistence/runtime invariants (operation gate, runtime generation,
    scoped repo views, ownership upserts, per-task context, atomic
    switch commit, two-phase import, etc.) for what is described as a
    developer-convenience feature. If the user-facing goal is "fast
    switch between Mutinynet and mainnet", a simpler approach is: keep
    the single-wallet store, add a "Save current wallet to slot N /
    load slot N" pair that does the dispose+rebuild but doesn't try to
    keep dormant ownership rows isolated. The plan should either
    justify why the heavier invariant set is the right tradeoff for an
    alpha, or down-scope.

---

**Bottom line:** The plan is detailed and the major risks (background task
ownership confusion, switch atomicity, late callbacks) are correctly
identified. The weakest areas are (a) the several "X or Y" hand-waves in
§1-§2 that defer real decisions, (b) the §4 task-context emulation that
assumes a package contract the doc doesn't verify, and (c) the §5/§7
switch/import flows missing explicit re-entry guards and overlay parity.
Nothing is fatal — but #1-#7 should be tightened before any code is
written, and #28 is worth a sanity check at the product level.
