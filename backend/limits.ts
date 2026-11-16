// A symbol's limits. The limits view works out what is left under them, and this object is the gate
// that checks each trade against that. Restate runs a `limits` object for each symbol, and one check
// at a time, so two trades can't both take the last of a limit. Its read of the view is at the foot
// of the file.
import * as restate from "@restatedev/restate-sdk/lambda";
import { eq, inArray, sql } from "drizzle-orm";
import { integer, numeric, pgMaterializedView, text } from "drizzle-orm/pg-core";
import { db } from "./database.ts";
import { tradesTable } from "./trades.ts";

// What the gate remembers for a symbol: each trade it has let through that the view may not count
// yet, as its value by its id. A new trade takes a moment to show in the view.
const LET_THROUGH = "letThrough";

// What the gate says of a trade: the price it books at, whether it fits, whether it is large enough
// to need approval, and how long it may wait for one, in seconds
export type Checked = { price: number; fits: boolean; needsApproval: boolean; approvalWait: number };

export const limits = restate.object({
  name: "limits",
  options: { journalRetention: { days: 30 } },
  handlers: {
    // Checks a trade of this quantity, positive to buy and negative to sell, at the latest price. Says
    // the price it books at, whether it fits, and whether it is large enough to need approval.
    check: async (ctx: restate.ObjectContext, trade: { id: string; quantity: number }): Promise<Checked> => {
      const letThrough = (await ctx.get<Record<string, number>>(LET_THROUGH)) ?? {};
      const view = await ctx.run("read the limits", () => readLimits(ctx.key, Object.keys(letThrough)));
      if (!view) throw new restate.TerminalError(`${ctx.key} can't be traded`);
      for (const id of view.counted) delete letThrough[id]; // the view counts these now

      const value = trade.quantity * view.latestPrice;
      const fits = Math.abs(value) <= room(view, letThrough, value > 0);
      if (fits) letThrough[trade.id] = value;
      ctx.set(LET_THROUGH, letThrough);
      return {
        price: view.latestPrice,
        fits,
        needsApproval: Math.abs(value) > view.approvalOver,
        approvalWait: view.approvalWaitSeconds,
      };
    },
  },
});

// The room left on one side: what the view says is available, less what the gate has let through on
// that side that the view doesn't count yet
function room(view: LimitsRow, letThrough: Record<string, number>, buying: boolean): number {
  const available = buying ? view.availableToBuy : view.availableToSell;
  const held = Object.values(letThrough).filter((value) => value > 0 === buying);
  return available - held.reduce((sum, value) => sum + Math.abs(value), 0);
}

// The columns of the limits view the gate reads, as model/views.sql defines them
const limitsView = pgMaterializedView("limits", {
  symbol: text("symbol").notNull(),
  latestPrice: numeric("latest_price", { mode: "number" }).notNull(),
  approvalOver: numeric("approval_over", { mode: "number" }).notNull(),
  approvalWaitSeconds: integer("approval_wait_seconds").notNull(),
  availableToBuy: numeric("available_to_buy", { mode: "number" }).notNull(),
  availableToSell: numeric("available_to_sell", { mode: "number" }).notNull(),
}).existing();

type LimitsRow = Awaited<ReturnType<typeof readLimits>> & {};

// Reads a symbol's row, and which of these trades the view already counts, in one statement, so both
// are from the same moment. Nothing comes back for a symbol the view lacks.
async function readLimits(symbol: string, ids: string[]) {
  const counted = db.select({ id: tradesTable.id }).from(tradesTable).where(inArray(tradesTable.id, ids));
  const [row] = await db
    .select({
      latestPrice: limitsView.latestPrice,
      approvalOver: limitsView.approvalOver,
      approvalWaitSeconds: limitsView.approvalWaitSeconds,
      availableToBuy: limitsView.availableToBuy,
      availableToSell: limitsView.availableToSell,
      counted: sql<string[]>`ARRAY(${counted})`,
    })
    .from(limitsView)
    .where(eq(limitsView.symbol, symbol));
  return row;
}
