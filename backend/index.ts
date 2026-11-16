// The function Restate calls. It holds the two services: the trades, and the limits.
import * as restate from "@restatedev/restate-sdk/lambda";
import { limits } from "./limits.ts";
import { trades } from "./trades.ts";

export const handler = restate.createEndpointHandler({ services: [trades, limits] });
