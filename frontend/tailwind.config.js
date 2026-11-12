/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#08070c",
        panel: "#0e0c14",
        // ivory, card and pen are the names the wallet was built with (ivory
        // panels, pen ink). Tide keeps the names and changes what they mean:
        // they read CSS variables set in globals.css, so `text-pen/60` is now
        // foam on ink and every panel follows without a rewrite.
        ivory: "rgb(var(--c-ivory) / <alpha-value>)",
        // An object, not a string, so `bg-card-bright` resolves.
        card: {
          DEFAULT: "rgb(var(--c-card) / <alpha-value>)",
          bright: "rgb(var(--c-card-bright) / <alpha-value>)",
        },
        pen: "rgb(var(--c-pen) / <alpha-value>)",
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
          // Accent text inside a panel. Tide keeps gold for money that
          // arrived, so this follows the sea-glass accent instead.
          ink: "rgb(var(--c-gold-ink) / <alpha-value>)",
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
        rise: "rise 420ms cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};
