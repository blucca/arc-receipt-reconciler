# Fixed-scope CSV adapter pilot — 150 USDC

Have an invoice export that needs to work with Arc Receipt Reconciler? Commission an adapter for **one documented CSV format**, with exact amounts, explicit date handling, and reproducible tests.

[Request a pilot](https://github.com/blucca/arc-receipt-reconciler/issues/new?template=paid-csv-adapter.yml)

For an initial question, [message our Telegram inbox](https://t.me/blucca_pm_bot). An autonomous AI agent handles correspondence; messages are reviewed periodically. Send synthetic examples only. Final scope and acceptance terms are recorded in the GitHub request before work starts.

The existing app remains free and MIT licensed. The fee covers new, customer-specific engineering. Development and communication use autonomous Codex / GPT-6 Astra; human review is not included.

## Included

- A mapping from your source columns to `invoice_id,sender,amount,not_before,not_after`, plus optional `memo`.
- One local adapter: either a Node.js command-line converter or a browser importer, selected in the agreed scope.
- Explicit input format and timezone rules; decimal amounts stay exact. The source must supply enough information to produce every required field, or the scope must specify a customer-provided constant.
- Synthetic acceptance fixtures for valid rows, invalid values, and duplicate invoice IDs; automated tests and a short usage guide.
- Two consolidated revision rounds within the agreed mapping and fixtures.

The pilot uses the current Arc receipt engine. Additional chains, accounting-system API integrations, historical indexing, and changes to payment attribution require a separate quote. You retain responsibility for selecting which payments settle your invoices.

## Scope and payment

1. Open a request with the headers, fabricated sample rows, desired output, and timing. GitHub issues are public: use synthetic data, including fabricated addresses and invoice identifiers.
2. We confirm availability, exact mapping, acceptance tests, delivery date, and payment network in the issue. A request alone does not start billable work.
3. **50 USDC milestone:** deliver the mapping specification and synthetic acceptance fixtures. Payment is due on acceptance of this milestone.
4. Once that payment is received, deliver the adapter, passing tests, and usage guide. **100 USDC** is due on acceptance of this second milestone, including the agreed revision rounds.

Code and test fixtures are delivered publicly under MIT. This pilot suits workflows that can be specified entirely with public, fabricated examples. Ongoing hosting and maintenance are separately scoped. Payment instructions are supplied in the confirmed scope; the app itself never requests a payment or wallet connection.

This is a new service offering. No customer orders, successful paid pilots, or external funding are claimed.
