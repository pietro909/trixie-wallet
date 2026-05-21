# Issues

Open items and follow-ups that do not yet belong to a milestone. If an issue grows into a scoped implementation effort, move it into a dedicated milestone doc under `docs/`.

Last updated: 2026-05-21

Resolved scoped efforts move under `docs/` with a `# RESOLVED` prefix — see [docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md](./docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md) for the former Issue 1 (notification classification and copy).

## Issue 1: Password Setup Is Too Slow

### Summary
Setting a password currently takes close to a minute, which is far too slow for an onboarding or security-setting flow.

### Current Behavior
- The password setup flow can take almost a minute before it completes.

### Expected Behavior
- Password setup should complete quickly enough that it feels immediate or near-immediate on a normal mobile device.
- Any intentionally expensive key-derivation work should still stay within a UX budget that does not make the app feel stalled.

### Open Questions
- Is the delay coming from PBKDF2 parameters, repeated persistence work, unnecessary serialization, or UI work being blocked on the main thread?
- Is the slowness uniform across platforms, or mostly visible on Android / lower-end devices?

### Notes
This should be treated as both a UX issue and a security-implementation review. If the current cost factor is justified, the UI still needs clearer progress feedback; if it is not justified, the derivation settings likely need tuning.

## Issue 2: Animation and Loading Feedback Pass

### Summary
Several flows feel static or stalled. The app needs a deliberate animation pass focused on lightweight, non-blocking motion and clearer progress feedback.

### Current Gaps
- Receive and send screens could use more pleasant motion.
- Activity-history loading can feel stuck with no sense of what the app is doing.
- Generic loaders feel flat during operations such as backup and support-bundle export.

### Expected Improvements
- Add subtle, non-blocking animations to send and receive flows.
- Make activity-history loading feel alive by surfacing more granular progress states, for example: `retrieving swaps`, `querying Esplora`, or similar step-level feedback.
- Replace boring generic loaders with more expressive motion, such as animated icons or animated text, for long-running operations like backup export or support-bundle generation.

### Constraints
- Motion should improve perceived responsiveness without slowing interaction or obscuring state.
- Loading feedback should stay honest: the UI should only show progress states the app can actually infer.

### Notes
This is a polish pass, but it touches real usability. The priority is not decorative animation; it is better perceived responsiveness and clearer system feedback.
