# Arc Receipt Reconciler

A dependency-free, read-only **Arc mainnet RPC web app** for reconciling incoming USDC receipts against local invoices. It deploys no contracts, connects no wallet, requests no signature, and submits no transaction.

The practical problem: one transaction can contain payments to multiple recipients; repeated RPC responses must not become repeated income. Arc also emits an ERC-20 mirror of some native USDC transfers. The app distinguishes transaction identity, canonical event identity, and business attribution.

**Live demo:** https://blucca.github.io/arc-receipt-reconciler/

**Project profile and one-minute demo guide:** [PROJECT.md](./PROJECT.md)

## Run locally

```sh
git clone https://github.com/blucca/arc-receipt-reconciler.git
cd arc-receipt-reconciler
python3 -m http.server 8080 --bind 127.0.0.1
# Open http://127.0.0.1:8080
```

An HTTP server is required for browser modules; opening `index.html` as `file://` is not supported. No installation, build step, API key, or third-party script is needed. The directory can be served by any static host, including branch-source GitHub Pages. Live hosting and grant eligibility are separate from local implementation; acceptance remains the program's decision.

1. Click **Load synthetic example** to try entirely offline data. It includes a duplicated log, two distinct payments in one transaction, an unrelated recipient, and a partial invoice.
   Or choose **Fetch public mainnet example**: it re-reads a real third-party 1 USDC transaction over RPC and pairs it with a clearly labeled illustrative invoice. It is not project revenue.
2. Enter your public receiving address and paste/open an invoice CSV. Importing the CSV only reads a local file.
3. Paste normalized transfer JSON, or explicitly fetch a known transaction / an inclusive block range from Arc mainnet. A range is limited to 1,000 blocks, 100 receipt transactions, and 10,000 logs; narrow large queries.
4. **Reconcile locally**. Exact, combined, partial, and ambiguous candidates remain unconfirmed.
5. Check receipts you recognize, then **Confirm selected business attribution**. Allocations use whole transfer logs: multiple receipt logs can settle one invoice, but one log cannot be split across multiple invoices. Partial and excess amounts remain explicit.
6. Export the JSON evidence. It contains invoice information, normalized transfer records, event IDs, selections, source information, and raw RPC receipts and matching block headers when fetched. Share the exported invoice data deliberately.

Nothing persists in cookies, localStorage, or a backend. Reloading/clearing discards current inputs and confirmations. Editing inputs invalidates allocations; a stale in-flight RPC response is discarded if inputs change.

## Invoice CSV

Required columns (any order):

```csv
invoice_id,sender,amount,not_before,not_after
INV-001,0x2222222222222222222222222222222222222222,30,2026-10-01T00:00:00Z,2026-10-31T23:59:59Z
```

Optional column: `memo`. Unknown or repeated headers, repeated invoice IDs, ragged rows, malformed quotes, and invalid amounts/timestamps fail closed. Quoted commas, escaped double quotes, CRLF/LF record separators, BOM, and quoted embedded line breaks are supported. IDs cannot contain control characters. The file picker has a 2 MB limit.

- `sender` is the address credited as `from` in the canonical transfer. This may be a paying contract rather than the transaction's gas payer.
- `amount` is a positive plain decimal string, with at most 18 fractional places in the Arc UI. No floats, exponents, rounding, currency signs, or negative values.
- Time windows are **inclusive**, UTC `YYYY-MM-DDTHH:mm:ss[.sss]Z`. No inferred timezone or missing date component. Core normalized transfers additionally accept integer Unix **seconds**.
- Exact amount, sender, recipient, and timestamp matches are only candidates. They do not establish that a transfer settled that invoice.

## Standardized offline transfer format

```json
[
  {
    "chainId": 5042,
    "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "logIndex": 10,
    "from": "0x2222222222222222222222222222222222222222",
    "to": "0x1111111111111111111111111111111111111111",
    "atomicAmount": "12000000000000000000",
    "decimals": 18,
    "timestamp": "2026-10-03T12:00:00Z"
  }
]
```

This example is **fabricated**, not a real receipt. Imported JSON is labeled unverified: its emitter/token provenance is not established by a user-supplied `chainId`. Only canonical system transfers belong in Arc input. The live adapter establishes its narrower source assumptions through RPC chain checks, emitter filtering, and receipt/header consistency checks.

`atomicAmount` is always an unsigned integer **string**; monetary arithmetic uses `BigInt`. `logIndex` is a nonnegative safe integer. Addresses/hash casing is normalized. All records must match the selected chain and decimal scale; mixed scales/chains are rejected. Repeated identical `chainId:txHash:logIndex` records are removed. Conflicting copies throw an error. Distinct log indexes remain distinct, even in the same transaction.

## Arc mainnet semantics

Source: [official USDC system events](https://docs.arc.io/arc/references/usdc-system-events.md), [official connection reference](https://docs.arc.io/arc/references/connect-to-arc.md).

| Field | Value |
|---|---|
| Chain ID | `5042` |
| Canonical USDC system emitter | `0xfffffffffffffffffffffffffffffffffffffffe` |
| Canonical event scale | **18 decimals** |
| ERC-20 USDC interface / mirror | `0x3600000000000000000000000000000000000000` |
| ERC-20 mirror scale | **6 decimals**, excluded from income stream |
| Read-only RPC options | `https://rpc.mainnet.arc.io`, `https://rpc.blockdaemon.mainnet.arc.io` |

The adapter accepts only the canonical emitter and standard Transfer signature. It excludes unrelated emitters and the ERC-20 mirror, classifies zero-address mint/burn separately, and validates each relevant log against its receipt. The invoice engine excludes mint/burn and zero-value entries from incoming payment attribution.

**Gas is per transaction:** `gasUsed × effectiveGasPrice`, 18-decimal USDC, recorded separately with the transaction payer. It is not deducted from each log or from the recipient's invoice amount; the transaction payer may be someone else.

`fixtures/arc-mainnet-receipt.json` contains a public third-party transaction with **one 1 USDC payment and two event representations**, observed via mainnet RPC. It is a test fixture, **not project revenue**, and contains no private key. Its explorer and observation source are recorded inside the file.

## Architecture and interface

- `core.mjs`: strict CSV parsing, UTC validation, decimal ↔ BigInt conversion, transfer normalization, event deduplication, invoice candidates, explicit allocations, JSON export. It has no network or DOM access.
- `arc-rpc.mjs`: read-only JSON-RPC adapter and pure `parseArcReceipt` decoder.
- `app.mjs`, `index.html`, `styles.css`: browser UI. Dynamic RPC import and requests run only after a fetch-button click. Untrusted CSV/JSON strings are rendered as text, not markup.
- `tests/`: Node built-in `node:test`; no dependencies.

```js
import { createArcRpc } from './arc-rpc.mjs';
const rpc = createArcRpc({ url: 'https://rpc.blockdaemon.mainnet.arc.io' });
const receipt = await rpc.getReceipt('0x…64 hex characters');
// { transfers, gas, rawReceipt, ... }; transfers have block timestamps.
const range = await rpc.getTransfers({ fromBlock: 123, toBlock: 124, recipient: '0x…40 hex characters' });
// { transfers, receipts, gasByTransaction, ... }
```

Core entry point:

```js
reconcile({ recipient, chain: 5042, decimals: 18, invoiceCsv, transfers, confirmations: {} });
// confirmations = { 'INV-001': ['5042:0x…:10', '5042:0x…:11'] }
```

Confirmed statuses mean **user-confirmed allocations**, not an independent attestation. Evidence is ordinary editable JSON; the app does not claim digital signatures, tamper-proof exports, invoice ownership proof, complete historical coverage, or independently verified chain finality. RPC providers are data sources; failed/CORS/timed-out reads are errors, never empty successful income reports. The current range reader is deliberately bounded and does not silently paginate or scan all history.

## Tests and measured scope

```sh
node --test tests/*.test.mjs
# or npm test (npm install is unnecessary)
```

At implementation handoff, **35 tests pass**: 19 core, 15 adapter, 1 end-to-end public-fixture integration. They cover quoting/CRLF, large exact amounts, calendar validation, same-tx multiple logs, conflicting repeats, mixed scales/chains, partial/excess payments, ambiguous invoices and double allocation, mint/burn, wrong-chain RPC, failed/missing receipts, mirrored events, range bounds, transport errors, and prototype-like invoice IDs.

A real Chromium browser has exercised the offline flow, a 390px mobile viewport, evidence download, and a live mainnet receipt read with the ERC-20 mirror excluded. Unit tests themselves are offline. The product has no transaction-writing path and no new contract deployment. Original code was developed using autonomous **Codex / GPT-6 Astra**, with separate agent review; no human review is implied. The bundled example and fixture-based invoice are illustrative and make no earnings claim.

## License

Original application code: MIT; see `LICENSE`. The public fixture is factual blockchain RPC data, with provenance retained. Arc names and network documentation belong to their respective owners.
