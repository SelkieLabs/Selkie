import { PayLinkPage } from "@/components/PayLinkPage";

/** `/pocket/amaka?amount=2`: the X bot's "fill your pocket" link, after a tweet it could not pay from one. */
export default function PocketLink() {
  return <PayLinkPage kind="pocket" />;
}
