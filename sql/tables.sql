-- The Postgres tables the views read, with some fake data. In the post they lived on Neon and were
-- replicated into Materialize.

CREATE TABLE instruments (
  id integer NOT NULL,
  symbol text NOT NULL,
  name text
);

CREATE TABLE trades (
  id integer NOT NULL,
  instrument_id integer,
  quantity integer NOT NULL,  -- positive for a buy, negative for a sell
  price numeric NOT NULL,
  executed_at timestamp NOT NULL
);

INSERT INTO instruments VALUES
  (1, 'AAPL', 'Apple Inc.'),
  (2, 'MSFT', 'Microsoft Corporation'),
  (3, 'NVDA', 'NVIDIA Corporation');

INSERT INTO trades VALUES
  (1, 1, 500, 265.20, '2025-06-02 14:31:07'),
  (2, 1, 300, 268.10, '2025-06-02 15:02:44'),
  (3, 1, -200, 271.40, '2025-06-02 16:18:30'),
  (4, 2, 200, 512.30, '2025-06-02 14:45:12'),
  (5, 2, 150, 514.75, '2025-06-02 17:09:58'),
  (6, 3, -800, 191.20, '2025-06-02 14:52:21'),
  (7, 3, 300, 188.40, '2025-06-02 18:37:05');
