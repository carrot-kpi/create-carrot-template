module.exports = {
    extends: ["turbo", "prettier"],
    plugins: ["prettier"],
    ignorePatterns: ["node_modules/", "dist/", "build/", ".turbo/"],
    rules: {
        "prettier/prettier": "error",
    },
    env: { es6: true },
    parserOptions: { sourceType: "module", ecmaVersion: "latest" },
};
