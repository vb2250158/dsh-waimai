# dsh-waimai

A DeepSeek Harness plugin for Taobao Instant Commerce and read-only Hema browsing. Sign-in, addresses, menus, cart and checkout use account-scoped HTTP interfaces. Meituan and JD are not integrated; Hema purchasing is disabled.

## Agent ordering

The public tool.call.toolview slot renders shops, menu recommendations, carts, checkout confirmations and payment handoffs inside the conversation. show_order uses real menu itemIds and an optional budget. Users can choose variants, required extras and quantity, add items, remove one unit and request a quote inside the card. Plugin pages retain their floating cart; chat cards use an inline cart.

Agents can read get_cart and get_item_options, then change_cart with the current revision and validated selection references. Cart changes do not create orders. submit_order requires accountRef, shopId and maxAmount in yuan; it reads the real checkout total and returns a user confirmation card. The card refreshes the quote and checks the account, selected address, cart revision, expiry and budget before submitting. An explicit user confirmation can place a manual order while automation preview stays enabled. Scheduled purchasing remains disabled.

Payment uses the official cashier page opened by the user. request_payment and get_order_status inspect local attempts and matching official orders; they never charge. Opening a URL or receiving HTTP success does not establish payment. Private addresses, credentials and payment URLs stay in authenticated UI RPC and are not included in model tool output. Unknown submissions reserve budget and must not be retried.

## Installation and validation

Install a fixed Git SHA through the managed DSH plugin installer. The package ships lib/ directly and has no build step. Run npm run check and npm test. Chinese documentation in README.md describes each configuration field, platform API and prior live validation. Migration guidance is in MIGRATION-0.3.0.md.

maxOrderAmount caps each order; dailyBudget caps daily reservations when nonzero. dryRun defaults to automation preview. loginDiagnostics records allowlisted login, cart and order stages without credentials or personal data. Existing local account and order files stay under DSH_HOME/waimai and never belong in environment sync.

Cart changes, prices and checkout have prior live validation. Order submission and payment UI use synthetic tests; real order creation and completed payment have not been exercised.

MIT
