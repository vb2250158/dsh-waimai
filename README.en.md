# dsh-waimai

A DeepSeek Harness plugin for Taobao Instant Commerce and read-only Hema browsing. Sign-in, addresses, menus, cart and checkout use account-scoped HTTP interfaces. Meituan and JD are not integrated; Hema purchasing is disabled.

QR accounts show the Taobao display nickname and self portrait from the same authenticated session. A portrait with another native nickname is rejected. Missing or failed portraits use the nickname initial with a refresh notice. Account IDs remain in account details; an absent nickname uses the unnamed-account label. Both the Taobao identity and ordering identity are checked around the read; changed identities stop profile display.

Each platform declares its login methods and default entry. Taobao provides QR and SMS. Hema separates its app QR entry, Taobao authorization QR and explicit reuse of a signed-in Taobao account. Hema app QR is not connected: the platform rejected the current desktop request. Selecting it never starts a Taobao QR attempt or replaces an account. Hema native SMS remains unverified and does not send codes. Plugin defaults do not claim verified official recommendations.

## Agent ordering

search_shops returns an opaque nextCursor for nearby merchant pages, including pages with no keyword matches. Positions are bound to the account, query, scope and native delivery selection; reloads, expiry or eviction require restarting from the first page. Advanced settings expose browseCursorSeconds and browseCursorLimit.

search_products reads current menus in up to ten explicitly selected stores. Results retain product names, pack descriptions, listed prices and availability, and declare selected-stores-only scope. Failed stores remain visible with complete: false. Explicit platform empty-store responses display their notice; unexplained or malformed responses remain errors. A case of water requires verification of bottle capacity, bottle count and the actual SKU; listed prices cannot establish the lowest checkout total.

Menu and preparation results use orderingAvailable for interactive ordering, automaticOrderingAvailable: false for disabled automated purchasing, and userConfirmationRequired: true for explicit confirmation.

The public tool.call.toolview slot renders shops, menu recommendations, carts, checkout confirmations and payment handoffs inside the conversation. show_order uses real menu itemIds and an optional budget. Users can choose variants, required extras and quantity, add items, remove one unit and request a quote inside the card. Plugin pages retain their floating cart; chat cards use an inline cart.

Agents can read get_cart and get_item_options, then change_cart with the current revision and validated selection references. Cart changes do not create orders. submit_order requires accountRef, shopId and maxAmount in yuan; it reads the real checkout total and returns a user confirmation card. The card refreshes the quote and checks the account, selected address, cart revision, expiry and budget before submitting. An explicit user confirmation can place a manual order while automation preview stays enabled. Scheduled purchasing remains disabled.

Payment uses the official cashier page opened by the user. request_payment and get_order_status inspect local attempts and matching official orders; they never charge. Opening a URL or receiving HTTP success does not establish payment. Private addresses, credentials and payment URLs stay in authenticated UI RPC and are not included in model tool output. Unknown submissions reserve budget and must not be retried.

## Installation and validation

Optional ingredient groups with zero allowance keep base variants available and disable extras. Zero is never interpreted as unlimited. Contradictory defaults, required extras or quantity rules stop the operation.

Install a fixed Git SHA through the managed DSH plugin installer. The package ships lib/ directly and has no build step. Run npm run check and npm test. Chinese documentation in README.md describes each configuration field, platform API and prior live validation. Migration guidance is in MIGRATION-0.3.0.md.

maxOrderAmount caps each order; dailyBudget caps daily reservations when nonzero. dryRun defaults to automation preview. loginDiagnostics records allowlisted login, cart and order stages without credentials or personal data. Existing local account and order files stay under DSH_HOME/waimai and never belong in environment sync.

Cart changes, prices and checkout have prior live validation. Order submission and payment UI use synthetic tests; real order creation and completed payment have not been exercised.

MIT
