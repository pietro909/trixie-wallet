# Issues

Open items and follow-ups that do not yet belong to a milestone. Items that grew into milestones are tracked in their respective docs instead.

- Wrong notifications
    - on `VTXO renewed` shows "payment received" (expected: no notification)
    - on payment sent shows "payment received" (expected: no notification)

- setting a password takes almost a minute
    - why is it so slow?

- we need more animations
    - receive/send screens (non-blocking, just pleasant)
    - when loading activity history, sometimes it feels like it's stuck
        - show more granular information like "retrieving swaps, reaching for Esplora, ... " to give a sense of motion
    - loaders are boring: can we animate single icons or text when doing stuff like backup, export support bundle, ...
