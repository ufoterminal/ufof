# Single live series display

The worker-owned shared packet and primary-pool trade tape remain the data pipeline.
No independent Latest / Last known price line is drawn. Candles and line mode use
the same execution series. MC uses the shared market packet's supply ratio.

The display checks primary-pool identity and closing price against that packet.
If history has not caught up, the chart shows synchronization instead of a second
contradictory price. This does not repair missing historical trades or invent OHLC.
Provider-only close-line fallback is no longer rendered independently.

During an outage stored verified data remains available, with a delayed-feed
notice. RPC recovery is necessary for new chain data; this change cannot provide
new swaps while upstream access is unavailable. The backend is not a copy of
ARC Screener's private implementation.

Validation: simulated browser feed checks all six timeframes, retained transaction
rows, series close/MC equality and absence of custom quote markers. Real-chain
validation remains pending while RPC services are down.
