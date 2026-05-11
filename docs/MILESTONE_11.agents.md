# Milestone 11: Transaction Visibility

Goal: give users accurate, honest visibility into pending funds and individual
VTXOs.

This milestone should prove:

- Pending swap transactions are visually distinct from settled ones in every
  list and detail view (color, label, status badge).
- Pending inbound amounts are never counted in the confirmed balance total.
- An optional pending-amount section in the balance breakdown makes in-flight
  funds visible without inflating the settled total.
- A user can open a paginated VTXO detail view listing every VTXO at their
  address with copy-to-clipboard and dust/unspendable labeling.

## Current State

- `lightning_swap` (reverse) activities show green inbound amounts and are
  styled as settled even when `rawStatus === 'pending'`, making the balance
  look larger than it is.
- The balance breakdown has no pending-amount section.
- There is no VTXO-level list view in the app; the Arkade Explorer
  (explorer.mutinynet.arkade.sh/address/…) is the only current way to inspect
  individual VTXOs.

## Product Rules

- A pending amount must never appear in the confirmed balance total.
- Pending items must be visually distinct from settled items in all Activity
  list rows and in the Activity detail screen.
- VTXO data must come from the SDK query, not from screen-scraping the
  explorer URL.
- The VTXO list must be paginated and must include dust and unspendable entries
  with a clear label — the user must have full visibility over their money.

## Selected Direction

Introduce a pending-state color token and apply it to activity rows and the
detail screen wherever `rawStatus === 'pending'`. Separate the pending amount
from the confirmed total in the balance breakdown and add an optional
pending-amount section. Build a VTXO detail screen (accessible from the
balance breakdown) with a paginated, copyable-per-VTXO list sourced from the
SDK; label dust/unspendable entries explicitly.
