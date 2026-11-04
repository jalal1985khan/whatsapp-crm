import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  { rules: { "react-hooks/set-state-in-effect": "warn" } },
];

export default config;
