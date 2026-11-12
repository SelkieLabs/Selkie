"use client";

import { Caustics } from "@/components/wallet/Caustics";

/**
 * The water every page sits in. Tide keeps it calm: ink, a faint glow from
 * the surface above, and caustic light drawn once and left still, so the
 * only light that moves in the app is the one on your balance.
 *
 * Fixed, behind everything, inert to the pointer and hidden from screen
 * readers. The landing paints its own sea over it.
 */
export function Scene() {
  return (
    <div className="sea-layer" aria-hidden="true">
      <div className="sea-glow" />
      <Caustics className="sea-caustic" tile={180} top={0.9} bottom={0} still />
    </div>
  );
}
