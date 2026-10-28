import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["spike/**", ".next/**", "node_modules/**"],
  },
];

export default config;
