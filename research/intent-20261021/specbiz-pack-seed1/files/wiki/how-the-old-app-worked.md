# How the old order app worked (2024, before the rebuild)

The old app was a port of an open-source order sample. One fulfilment per warehouse; a customer action raced a timer; the card was charged with an idempotency key, then the shipment was booked and the carrier sent updates.

What it did NOT do: it never refunded. If shipping failed after a successful charge, the fulfilment was marked failed and the money stayed charged. It also had no fraud check and no cancel once processing had started, and its timer could fire at the very deadline. Customers complained a lot, which is why we rebuilt it in 2025.
