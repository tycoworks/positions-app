-- Post 1's positions logic: the latest price per symbol, then positions and P&L per instrument.
-- Reads instruments and trades (tables.sql) and market_data, the price feed: symbol, price and
-- timestamp (epoch milliseconds).

CREATE MATERIALIZED VIEW latest_market_data AS
  SELECT DISTINCT ON (symbol) symbol, price, timestamp
  FROM market_data
  ORDER BY symbol, timestamp DESC;

CREATE MATERIALIZED VIEW positions AS
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
  WHERE t.status = 'Booked'
  GROUP BY i.id, i.symbol, md.price;

-- Each instrument's limits: the rules set for it, how much of its position limit is used, and what is
-- left to buy and to sell. Booked trades count at the latest price, through the position's market
-- value. A pending trade counts on its own side, at the price it was requested at.
CREATE MATERIALIZED VIEW limits AS
  SELECT
    i.id AS instrument_id,
    i.symbol,
    md.price AS latest_price,
    l.position_limit,
    l.approval_over,
    l.approval_wait_seconds,
    COALESCE(p.market_value, 0) AS market_value,
    COALESCE(pending.buys, 0) AS pending_buys,
    COALESCE(pending.sells, 0) AS pending_sells,
    l.position_limit - COALESCE(p.market_value, 0) - COALESCE(pending.buys, 0) AS available_to_buy,
    l.position_limit + COALESCE(p.market_value, 0) + COALESCE(pending.sells, 0) AS available_to_sell,
    -- The share of the limit used on the fuller side, long or short
    GREATEST(
      COALESCE(p.market_value, 0) + COALESCE(pending.buys, 0),
      -(COALESCE(p.market_value, 0) + COALESCE(pending.sells, 0))
    ) / l.position_limit AS utilisation
  FROM instruments AS i
  JOIN limit_rules AS l ON l.instrument_id = i.id
  JOIN latest_market_data AS md ON md.symbol = i.symbol
  LEFT JOIN positions AS p ON p.instrument_id = i.id
  LEFT JOIN (
    SELECT
      instrument_id,
      SUM(quantity * price) FILTER (WHERE quantity > 0) AS buys,
      SUM(quantity * price) FILTER (WHERE quantity < 0) AS sells
    FROM trades
    WHERE status = 'Pending'
    GROUP BY instrument_id
  ) AS pending ON pending.instrument_id = i.id;

-- The trades that aren't booked, which the page shows as requests: those waiting for approval, and
-- those turned down. A trade leaves this view once it is booked, and counts in its position.
CREATE MATERIALIZED VIEW requests AS
  SELECT id, instrument_id, quantity, price, executed_at, status
  FROM trades
  WHERE status <> 'Booked';
