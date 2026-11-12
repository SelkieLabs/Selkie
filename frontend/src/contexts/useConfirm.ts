"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The yes button: say what happens ("Send 5.00 USDC"), never just "OK". */
  confirm: string;
  cancel?: string;
  /** "money" signs and sends; "danger" is a one-way choice that moves nothing. */
  tone?: "money" | "danger";
  /** The facts that matter, as label / value rows. */
  rows?: Array<{ label: string; value: ReactNode }>;
  /** Small print under the rows. Defaults to the signing line for money. */
  note?: ReactNode;
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<Confirm>(async () => true);

/** `await confirm({...})` is true only when the person said yes. */
export const useConfirm = () => useContext(ConfirmContext);
