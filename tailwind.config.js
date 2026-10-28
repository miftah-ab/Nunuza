/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ─── Brand colour tokens ────────────────────────────────────────────────
      colors: {
        // Primary actions & brand
        forest: {
          DEFAULT: "#174C3C",
          hover:   "#103B2F",
          light:   "#EAF2EE",
          muted:   "#C9DECE",
        },
        // Surfaces
        offwhite: "#F8F8F5",
        // Text
        ink: {
          DEFAULT:   "#202522",
          secondary: "#68716C",
        },
        // Borders & dividers
        border: "#E4E8E3",
        // Semantic status
        success: { DEFAULT: "#287A50", light: "#EAF5EF" },
        warning: { DEFAULT: "#A86412", light: "#FDF3E3" },
        error:   { DEFAULT: "#B93838", light: "#FDEAEA" },
      },

      // ─── Typography ─────────────────────────────────────────────────────────
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        "page-title":    ["30px", { lineHeight: "1.2", fontWeight: "700" }],
        "section-title": ["20px", { lineHeight: "1.3", fontWeight: "600" }],
        body:            ["15px", { lineHeight: "1.6" }],
        secondary:       ["13px", { lineHeight: "1.5" }],
      },

      // ─── Spacing ─────────────────────────────────────────────────────────────
      spacing: {
        "4.5":  "1.125rem",
        "13":   "3.25rem",
        "15":   "3.75rem",
        "18":   "4.5rem",
        "22":   "5.5rem",
        "26":   "6.5rem",
        "30":   "7.5rem",
      },

      // ─── Shadows ────────────────────────────────────────────────────────────
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        "card-hover": "0 4px 12px 0 rgb(0 0 0 / 0.08)",
        focus: "0 0 0 3px rgb(23 76 60 / 0.2)",
      },

      // ─── Border radius ──────────────────────────────────────────────────────
      borderRadius: {
        lg:  "0.625rem",
        xl:  "0.875rem",
        "2xl": "1rem",
      },

      // ─── Animation ──────────────────────────────────────────────────────────
      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%":   { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in":  "fade-in 0.25s ease-out",
        "slide-in": "slide-in 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
