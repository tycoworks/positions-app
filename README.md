# positions-app

A live positions and trades screen, for testing real-time infrastructure for trading apps in the [tycoworks](https://www.tycoworks.com) posts.

[Materialize](https://materialize.com/) computes positions and P&L, and [tycostream](https://github.com/tycoworks/tycostream) streams them to the browser as GraphQL subscriptions over server-sent events.

## Running it

```
docker compose up -d
cd ui
npm install
npm run dev
```

Open http://localhost:5173 and click a position to see its trades. tycostream's GraphQL explorer is at http://localhost:4000/graphql.

## Versions

- [`v1`](https://github.com/tycoworks/positions-app/tree/v1), for [Can a Streaming Database Power Trading Apps?](https://www.tycoworks.com/p/can-a-streaming-database-power-a): streams through Kafka and Zilla
- `v2`, for [the tycostream post](https://www.tycoworks.com/p/tycostream-turn-materialize-views): streams through tycostream

## Tested with

- Materialize v26.49
- tycostream v0.2.0
