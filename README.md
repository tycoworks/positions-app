
# positions-app

A live positions and trades UI, for testing real-time infrastructure for trading apps in the [tycoworks](https://www.tycoworks.com) posts.

- [Materialize](https://materialize.com/) computes positions, P&L, and limits.
- [tycostream](https://github.com/tycoworks/tycostream) streams them to the browser as GraphQL subscriptions over server-sent events.
- [Restate](https://restate.dev/) checks limits and books trades from the page as durable workflows.

https://github.com/user-attachments/assets/b56982b1-af99-4904-9cab-7b4fb788d765

## Running it

```
docker compose up -d
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. tycostream's GraphQL explorer is at http://localhost:4000/graphql, and Restate's UI is at http://localhost:9070.

## Tests

To run the tests, on a freshly started stack:

```
cd test
npm install
npm test
```

## Versions

- [`v1`](https://github.com/tycoworks/positions-app/tree/v1), for [Can a Streaming Database Power Trading Apps?](https://www.tycoworks.com/p/can-a-streaming-database-power-a): streams through Kafka and Zilla
- [`v2`](https://github.com/tycoworks/positions-app/tree/v2), for [Can You Build a View Server with Materialize and GraphQL?](https://www.tycoworks.com/p/tycostream-turn-materialize-views): streams through tycostream

## Tested with

- Materialize v26.49
- tycostream v0.6.0
- Restate v1.8.1
- Floci v2.4.0
