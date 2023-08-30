module.exports = {
    extends: ["turbo", "prettier"],
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint", "prettier"],
    ignorePatterns: [
        "node_modules/",
        "dist",
        "build/",
        ".turbo/",
        "CHANGELOG.md",
    ],
    rules: {
        "prettier/prettier": "error",
    },
    env: { es6: true },
    parserOptions: { sourceType: "module", ecmaVersion: "latest" },
};
