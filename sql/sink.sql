-- Sends every change to live_pnl to the live_pnl topic, keyed by instrument, for Zilla to serve.
-- Needs a Kafka connection named kafka, created separately with your broker's address and login.

CREATE SINK live_pnl_sink
  FROM live_pnl
  INTO KAFKA CONNECTION kafka (
    TOPIC 'live_pnl',
    -- Keep each instrument's latest row indefinitely, so a new page always gets every position.
    TOPIC CONFIG MAP['cleanup.policy' => 'compact'],
    -- Materialize compresses with lz4 by default, and Zilla 2.6.0 doesn't deliver compressed messages.
    COMPRESSION TYPE = 'none'
  )
  -- live_pnl groups by instrument, symbol and price, so Materialize can't tell that instrument_id alone
  -- is unique. It is: an instrument has one symbol, and a symbol has one latest price.
  KEY (instrument_id) NOT ENFORCED
  FORMAT JSON
  ENVELOPE UPSERT;
