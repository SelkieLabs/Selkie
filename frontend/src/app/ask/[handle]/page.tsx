import { PayLinkPage } from "@/components/PayLinkPage";

/** `/ask/amaka?amount=5`: the X bot's answer to "ask @amaka for 5". */
export default function AskLink() {
  return <PayLinkPage kind="ask" />;
}
