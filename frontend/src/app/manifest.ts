import type { MetadataRoute } from "next";

/**
 * What a phone needs to put Selkie on its Home Screen as an app. On iPhone and
 * iPad that is also the only way to get notifications when money comes in:
 * Safari offers Web Push only to sites added to the Home Screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Selkie",
    short_name: "Selkie",
    description: "Send money to any X handle.",
    start_url: "/wallet/home",
    display: "standalone",
    background_color: "#04101a",
    theme_color: "#04101a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
