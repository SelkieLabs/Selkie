import { PayLinkPage } from "@/components/PayLinkPage";

/** `/pay/amaka?amount=5`: the X bot's answer to "send 5 to @amaka". */
export default function PayLink() {
  return <PayLinkPage kind="pay" />;
}
