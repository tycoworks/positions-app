-- Post 1's positions logic: the latest price per symbol, then positions and P&L per instrument.
-- Reads instruments and trades (tables.sql) and market_data, the price feed: symbol, price and
-- timestamp (epoch milliseconds).

CREATE MATERIALIZED VIEW latest_market_data AS
  SELECT DISTINCT ON (symbol) symbol, price, timestamp
  FROM market_data
  ORDER BY symbol, timestamp DESC;

CREATE MATERIALIZED VIEW live_pnl AS
  SELECT
    i.id AS instrument_id,
    i.symbol,
    SUM(t.quantity) AS net_position,
    md.price AS latest_price,
    SUM(t.quantity) * md.price AS market_value,
    SUM(t.price * t.quantity) / NULLIF(SUM(t.quantity), 0) AS avg_cost_basis,
    SUM(t.quantity) * md.price - SUM(t.price * t.quantity) AS theoretical_pnl
  FROM trades AS t
  JOIN instruments AS i ON i.id = t.instrument_id
  JOIN latest_market_data AS md ON md.symbol = i.symbol
  GROUP BY i.id, i.symbol, md.price;
