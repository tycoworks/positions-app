// A trade, from request to outcome, as a state machine declared in XState: its statuses, and the
// moves allowed between them. Restate runs the machine as the `trades` Virtual Object, one for each
// trade under the request's id, and keeps its snapshot. Entering a status writes it to the trade's
// row, through Drizzle, at the foot of the file.
import { createMachineObject, fromHandler, fromPromise } from "@restatedev/xstate";
import { and, eq, notExists, sql } from "drizzle-orm";
import { integer, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { setup, types } from "xstate";
import { z } from "zod";
import { Answer, TradeStatus } from "../model/enums.ts";
import { db } from "./database.ts";
import { type Checked, limits } from "./limits.ts";

// The two states a trade has no status for: before its check, and when it can't be a trade at all
const REQUESTED = "Requested";
const INVALID = "Invalid";

// What the page asks for. The quantity is positive to buy and negative to sell. A request that
// doesn't fit this is turned away before the machine is created.
const Request = z.object({
  symbol: z.string().min(1),
  quantity: z.number().int().refine((quantity) => quantity !== 0, "quantity can't be zero"),
});
type Request = z.infer<typeof Request>;

// What the machine keeps for a trade. The id, the price, and how long an approval may take, in
// seconds, arrive with the check. The wait is the symbol's, from the limit rules.
type Context = Request & { id: string | null; price: number | null; approvalWait: number | null };
type Trade = Request & { id: string; price: number };

// Asks the symbol's limits whether the trade fits, at what price, and whether it needs approval
const check = fromHandler<Checked & { id: string }, Request>(async ({ input, ctx }) => {
  const checked = await ctx.objectClient(limits, input.symbol).check({ id: ctx.key, quantity: input.quantity });
  return { ...checked, id: ctx.key };
});

// Writes the status a trade enters: its first as a new row, a later one as a move from pending
const write = fromPromise<void, { trade: Trade; status: TradeStatus }>(
  async ({ input }) => {
    await insertTrade(input.trade, input.status);
    if (input.status !== TradeStatus.Pending) await updateTrade(input.trade.id, input.status);
  },
  { retry: true },
);

// Entering a status writes it to the trade's row
const writes = (status: TradeStatus) => ({
  src: "write" as const,
  input: ({ context }: { context: Context }) => ({ trade: context as Trade, status }),
});

const machine = setup({
  schemas: {
    input: Request,
    context: types<Context>(),
    events: { [Answer.Approve]: z.object({}), [Answer.Reject]: z.object({}) },
  },
  actors: { check, write },
  // How long a pending trade waits for an answer before it expires: its symbol's approval wait
  delays: { approvalWait: ({ context }) => context.approvalWait! * 1000 },
}).createMachine({
  id: "trade",
  initial: REQUESTED,
  context: ({ input }) => ({ ...input, id: null, price: null, approvalWait: null }),
  states: {
    [REQUESTED]: {
      invoke: {
        src: "check",
        input: ({ context }) => ({ symbol: context.symbol, quantity: context.quantity }),
        onDone: ({ output }) => ({
          target: !output.fits ? TradeStatus.Refused : output.needsApproval ? TradeStatus.Pending : TradeStatus.Booked,
          context: { id: output.id, price: output.price, approvalWait: output.approvalWait },
        }),
        onError: { target: INVALID },
      },
    },
    // Waits for a second person's answer. If none comes in time, it expires: Restate keeps the timer.
    [TradeStatus.Pending]: {
      invoke: writes(TradeStatus.Pending),
      after: { approvalWait: { target: TradeStatus.Expired } },
      on: {
        [Answer.Approve]: { target: TradeStatus.Booked },
        [Answer.Reject]: { target: TradeStatus.Rejected },
      },
    },
    [TradeStatus.Booked]: { invoke: writes(TradeStatus.Booked) },
    [TradeStatus.Refused]: { invoke: writes(TradeStatus.Refused) },
    [TradeStatus.Rejected]: { invoke: writes(TradeStatus.Rejected) },
    [TradeStatus.Expired]: { invoke: writes(TradeStatus.Expired) },
    // A request that can't be a trade, such as one for a symbol with no price. Nothing is written.
    [INVALID]: {},
  },
});

export const trades = createMachineObject("trades", machine, { journalRetention: { days: 30 } });

// The trades table, and the instruments table that gives a symbol its id, as model/tables.sql defines
// them. In a firm, these writes would go to whatever owns its trades.
const instrumentsTable = pgTable("instruments", {
  id: integer("id").notNull(),
  symbol: text("symbol").notNull(),
});
const tradeStatus = pgEnum("trade_status", TradeStatus);
export const tradesTable = pgTable("trades", {
  id: text("id").notNull(),
  instrumentId: integer("instrument_id"),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { mode: "number" }).notNull(),
  executedAt: timestamp("executed_at").notNull(),
  status: tradeStatus("status").notNull(),
});

// Writes a trade with its first status. A trade that is already written is left as it is, so this
// is safe to repeat.
async function insertTrade(trade: Trade, status: TradeStatus): Promise<void> {
  await db.insert(tradesTable).select(
    db
      .select({
        id: sql<string>`${trade.id}::text`.as("id"),
        instrumentId: instrumentsTable.id,
        quantity: sql<number>`${trade.quantity}::integer`.as("quantity"),
        price: sql<number>`${trade.price}::numeric`.as("price"),
        executedAt: sql<Date>`now()::timestamp`.as("executed_at"),
        status: sql<TradeStatus>`${status}::text`.as("status"),
      })
      .from(instrumentsTable)
      .where(
        and(
          eq(instrumentsTable.symbol, trade.symbol),
          notExists(db.select({ id: tradesTable.id }).from(tradesTable).where(eq(tradesTable.id, trade.id))),
        ),
      ),
  );
}

// Moves a pending trade to its outcome. A trade that isn't pending is left as it is. Only booking
// moves its time, since that is when it executes: a rejected or expired request keeps the time it was
// made.
async function updateTrade(id: string, status: TradeStatus): Promise<void> {
  await db
    .update(tradesTable)
    .set(status === TradeStatus.Booked ? { status, executedAt: sql`now()::timestamp` } : { status })
    .where(and(eq(tradesTable.id, id), eq(tradesTable.status, TradeStatus.Pending)));
}
