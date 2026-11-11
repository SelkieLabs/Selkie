import type { Account, Money } from "../chains/types";

// Airtime, data, and bills, paid from a Selkie balance.
//
// Privacy rule (see the product scope): the phone number, meter number, and biller
// details a user enters here NEVER go onto a public timeline. These calls run on the
// private surfaces (DM, web) only, and the public reply just confirms "done".

export interface AirtimePurchase {
  phone: string;
  /** Network operator, when the provider needs it named. */
  operator?: string;
  amount: Money;
}

export interface BillPayment {
  biller: string;
  /** Meter number, account number, smartcard, etc. */
  customerRef: string;
  amount: Money;
}

export interface AirtimeBillsProvider {
  readonly id: string;
  buyAirtime(account: Account, params: AirtimePurchase): Promise<{ ref: string }>;
  payBill(account: Account, params: BillPayment): Promise<{ ref: string }>;
  status(ref: string): Promise<"pending" | "completed" | "failed">;
}
