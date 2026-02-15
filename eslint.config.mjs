import js from "@eslint/js";
import globals from "globals";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**"],
  },
  {
    files: ["**/*.{js,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {},
  },
];
