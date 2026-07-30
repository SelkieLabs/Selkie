import { redirect } from "next/navigation";

/** The wallet is always tabbed; the bare URL opens on activity. */
export default function DashboardIndex() {
  redirect("/dashboard/activity");
}
