# positions-app

A live positions grid, from the post [Can a Streaming Database Power Trading Apps?](https://www.tycoworks.com/p/can-a-streaming-database-power-a)

Materialize computes positions and P&L, sinks them to Kafka, and Zilla streams the topic to an AG Grid page over server-sent events.

- `sql/`: the Postgres tables, the views, and the sink of `live_pnl` to Kafka
- `ui/`: the page

The views read `instruments` and `trades`, the Postgres tables in `sql/tables.sql`. They also read `market_data`, a price feed with `symbol`, `price` and `timestamp` (epoch milliseconds) columns, which in the post was Alpaca's trade prints, brought in through Estuary.

## Running it

You need Materialize, a Kafka broker, and Zilla serving the `live_pnl` topic at `/live_pnl`. In Materialize:

1. Create a Kafka connection named `kafka`.
2. Run `sql/tables.sql`, and bring in `market_data` from your price feed.
3. Run `sql/views.sql`, then `sql/sink.sql`.

Then start the page:

```
cd ui
npm install
npm run dev
```

The page expects Zilla at `http://localhost:7114`. Set `VITE_ZILLA_URL` to change it.

## Tested with

- Materialize v26.49
- Apache Kafka 4.4.0, one node, with automatic topic creation off
- Zilla 2.6.0 (community edition), with one `sse-kafka` route on the `live_pnl` topic
- The sink writes a compacted, uncompressed topic keyed by `instrument_id`
