# Activity-history fixtures

## `transaction_history.json`

Verbatim copy of `ts-sdk/test/fixtures/transaction_history.json`, used as
the SDK-parity bar for `buildActivityHistory`.

- **Source repo**: `ark/ts-sdk`
- **Source commit**: `afb6def2ea27302c3ef436d7053e644a41d73407`
- **Source path**: `test/fixtures/transaction_history.json`

The parity test (`../activity-history.parity.test.ts`) asserts that for
every SDK row produced by `buildTransactionHistory` against these inputs,
our `buildActivityHistory` emits a semantically equivalent `Activity` row
(renamed per spec §9.1), plus our additional wallet-event rows (renewal,
boarding_settled, settlement, asset).

## Refresh

When the SDK fixture is updated upstream:

```bash
cp ../../../../../../ts-sdk/test/fixtures/transaction_history.json \
   app/services/arkade/__tests__/fixtures/transaction_history.json
# Update the commit hash above, then run the parity tests.
```

Parity failures after a refresh usually mean the SDK added a row type or
changed semantics — see `docs/ACTIVITY_HISTORY.specs.md` §9.3 for the
divergence catalogue before "fixing" anything.
