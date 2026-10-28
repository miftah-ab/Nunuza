/**
 * Centralized design token definitions.
 * Import this file in components that need to reference tokens as JS/TS values
 * (e.g., in dynamic styles or tests).
 * For Tailwind class usage, reference tailwind.config.js token names directly.
 */

export const tokens = {
  colors: {
    forest:       "#174C3C",
    forestHover:  "#103B2F",
    forestLight:  "#EAF2EE",
    forestMuted:  "#C9DECE",
    offwhite:     "#F8F8F5",
    white:        "#FFFFFF",
    ink:          "#202522",
    inkSecondary: "#68716C",
    border:       "#E4E8E3",
    success:      "#287A50",
    successLight: "#EAF5EF",
    warning:      "#A86412",
    warningLight: "#FDF3E3",
    error:        "#B93838",
    errorLight:   "#FDEAEA",
  },
  font: {
    sans: "'Inter', system-ui, sans-serif",
  },
  fontSize: {
    pageTitle:    "30px",
    sectionTitle: "20px",
    body:         "15px",
    secondary:    "13px",
  },
} as const;

export type ColorToken = keyof typeof tokens.colors;
