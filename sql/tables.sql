-- The tables post 1's views read. In post 1, instruments and trades were Postgres tables on Neon,
-- replicated into Materialize, and market_data was a Kafka topic of Alpaca trade prints, fed by Estuary.

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

CREATE TABLE market_data (
  symbol text NOT NULL,
  price numeric NOT NULL,
  timestamp bigint NOT NULL  -- epoch milliseconds
);

INSERT INTO instruments VALUES
  (1, 'AAPL', 'Apple Inc.'),
  (2, 'MSFT', 'Microsoft Corporation'),
  (3, 'NVDA', 'NVIDIA Corporation');
