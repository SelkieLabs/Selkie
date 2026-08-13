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
      },
      fontFamily: {
        display: [
          '"Bricolage Grotesque"',
          '"Space Grotesk"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
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
