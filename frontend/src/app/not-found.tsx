"use client";

import { Redirect } from "@/components/Redirect";

/**
 * Anything we don't have a route for lands back at the front door, the way the
 * old catch-all route did. Next still answers 404 on the wire, which is right:
 * the URL really doesn't exist, and only the person typing it gets moved.
 */
export default function NotFound() {
  return <Redirect to="/" />;
}
