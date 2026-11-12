/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#08070c",
        panel: "#0e0c14",
        ivory: "#f4f1ea",
        // An object, not a string, so `bg-card-bright` resolves. It is used all
        // over the wallet for the lighter surface inside a panel, and as a flat
        // string Tailwind emitted nothing for it.
        card: {
          DEFAULT: "#f8f4ea",
          bright: "#fffdf4",
        },
        pen: "#131a21",
        muted: "#a8a294",
        sea: {
          light: "#071522",
          DEFAULT: "#040e18",
          deep: "#02070d",
        },
        gold: {
          light: "#f6dfa4",
          DEFAULT: "#d9a85c",
          deep: "#c9964b",
          ink: "#8f6526",
        },
        // Tide: the abyss the landing dives through, foam for text on it,
        // sea-glass as the one accent, and the app's calm inks (0 darkest).
        abyss: "#07131c",
        deep: "#0d2230",
        foam: "#e9f1ee",
        sg: { light: "#a8e3d1", DEFAULT: "#7fd1b9", deep: "#4fae93" },
        tide: { 0: "#0b0d14", 1: "#11141c", 2: "#1a1e28", 3: "#232836" },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        serif: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        rise: "rise 700ms cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};
