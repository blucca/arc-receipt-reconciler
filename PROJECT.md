# Arc Receipt Reconciler

**Reconcile Arc USDC payments with private invoices and exact, reviewable receipt evidence.**

[Open the app](https://blucca.github.io/arc-receipt-reconciler/) · [Source and tests](https://github.com/blucca/arc-receipt-reconciler) · [480 × 480 project logo](https://blucca.github.io/arc-receipt-reconciler/assets/logo-480.png)

## The problem

A successful transfer alone does not explain which invoice was paid. A single transaction can also contain several payments. On Arc, an ordinary USDC transfer can appear as both a canonical 18-decimal system event and a 6-decimal ERC-20 mirror; treating both as income doubles the receipt.

## What it does

Arc Receipt Reconciler matches incoming mainnet USDC payments to local invoice CSVs, keeps amounts exact, and asks the user to confirm which receipts belong to which invoice. It exports the allocation decisions alongside normalized transfers, original RPC receipts, block headers, and separately recorded transaction gas.

The browser reads the official canonical system events and excludes their ERC-20 mirrors. Receipt identity includes the chain, transaction hash, and log index, so two payments in one transaction remain distinct. Partial and combined payments are supported, and ambiguous matches remain explicit.

Invoice data stays in the browser. Live reads send only public chain queries to a public RPC endpoint. No account, wallet connection, signature, application backend, or new contract is required.

## Try the mainnet demo in one minute

1. Open the app and click **Fetch public mainnet example**.
2. The app fetches transaction `0x8230a509afec7386b28252801ab4b6a180a4601822feee39cf8269c1c6c6ac71` from Arc mainnet, chain **5042**.
3. Inspect the **1 USDC** canonical receipt. Its ERC-20 mirror is excluded; the receipt is a candidate until explicitly attributed.
4. Select the receipt, confirm its attribution to the illustrative invoice, then export the JSON evidence.

This replay is a **public third-party transaction**, paired with an illustrative invoice. It is a reproducible demonstration, not a transaction made by this project or evidence of customer usage or project income. [View the transaction](https://explorer.arc.io/tx/0x8230a509afec7386b28252801ab4b6a180a4601822feee39cf8269c1c6c6ac71).

**Load synthetic example** additionally demonstrates multiple payment logs, duplicates, and a partial invoice without RPC requests.

## Current scope

This is a working read-only web application using Arc mainnet RPC data, hosted on GitHub Pages. It does not deploy a custom contract. It uses exact BigInt arithmetic and has 35 repository tests covering reconciliation and the RPC adapter. Additional browser checks cover mobile layout, downloads, local processing, and real mainnet reads.

The original implementation was developed autonomously with Codex / GPT-6 Astra and reviewed by separate agents. Human code review is not claimed. Original application code and the original project logo are MIT licensed.

The tool currently has no claimed customers, revenue, or external funding. Its next useful step is feedback from real Arc payment operators about their invoice formats and reconciliation workflow.
