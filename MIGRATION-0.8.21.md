# 0.8.21

New order attempts retain an optional `itemSummary` derived from the confirmed quote. Existing journals remain readable. Agent Pay requires this confirmed summary and stops before submitting payment for older orders without it. After new records have been written, restore the pre-upgrade journal backup before downgrading to an older strict reader. No payment credentials or signed URLs are added to durable storage.
