// The model's enums, for the code on both sides: the function and the page. They repeat the enums in
// schema.yaml by hand.

// The statuses a trade can have
export enum TradeStatus {
  Pending = "Pending",
  Booked = "Booked",
  Refused = "Refused",
  Rejected = "Rejected",
  Expired = "Expired",
}

// The answers a second person can give a pending trade, which are events of its machine
export enum Answer {
  Approve = "Approve",
  Reject = "Reject",
}
