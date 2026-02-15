import js from "@eslint/js";
import globals from "globals";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["**/*.{js,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    extends: ["eslint:recommended"],
    rules: {
      // add project-specific rules here if needed
    },
  },
];
