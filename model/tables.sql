-- The tables the views read, with some fake data. In the post, instruments and trades lived in
-- Postgres on Neon and were replicated into Materialize.

CREATE TABLE instruments (
  id integer NOT NULL,
  symbol text NOT NULL,
  name text
);

CREATE TABLE trades (
  id text NOT NULL,           -- for a trade booked from the page, its request's id
  instrument_id integer,
  quantity integer NOT NULL,  -- positive for a buy, negative for a sell
  price numeric NOT NULL,
  executed_at timestamp NOT NULL,
  status text NOT NULL        -- Pending, Booked, Refused, Rejected or Expired
);

-- The rules that limit trading in each instrument.
CREATE TABLE limit_rules (
  instrument_id integer NOT NULL,
  position_limit numeric NOT NULL,         -- the most its market value may be, long or short
  approval_over numeric NOT NULL,          -- a trade worth more than this needs a second person's approval
  approval_wait_seconds integer NOT NULL   -- how long such a trade waits for an answer before it expires
);

-- The price feed. In the post it was Alpaca's trade prints, brought in through Estuary; here the
-- simulator (data.sh) fills it.
CREATE TABLE market_data (
  symbol text NOT NULL,
  price numeric NOT NULL,
  timestamp bigint NOT NULL  -- epoch milliseconds
);

INSERT INTO instruments VALUES
  (1, 'AAPL', 'Apple Inc.'),
  (2, 'GOOG', 'Alphabet Inc.'),
  (3, 'MSFT', 'Microsoft Corporation');

INSERT INTO limit_rules VALUES
  (1, 500000, 100000, 60),
  (2, 500000, 100000, 60),
  (3, 500000, 100000, 60);

INSERT INTO trades VALUES
  ('1', 1, 500, 198.40, '2025-06-02 14:31:07', 'Booked'),
  ('2', 1, 300, 200.10, '2025-06-02 15:02:44', 'Booked'),
  ('3', 1, -200, 203.20, '2025-06-02 16:18:30', 'Booked'),
  ('4', 2, 200, 172.30, '2025-06-02 14:45:12', 'Booked'),
  ('5', 2, 150, 174.75, '2025-06-02 17:09:58', 'Booked'),
  ('6', 3, -800, 462.20, '2025-06-02 14:52:21', 'Booked'),
  ('7', 3, 300, 458.40, '2025-06-02 18:37:05', 'Booked');
