const { join } = require("path");
const { nodeResolve } = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const json = require("@rollup/plugin-json");
const { terser } = require("rollup-plugin-terser");
const { sync: globSync } = require("glob");
const shebang = require("rollup-plugin-preserve-shebang");
const { dependencies } = require("./package.json");

const external = Object.keys(dependencies);

module.exports = [
    {
        input: globSync(join(__dirname, "./src/**/*.mjs")),
        plugins: [json(), shebang(), nodeResolve(), commonjs(), terser()],
        external,
        output: [
            {
                dir: join(__dirname, "./dist/"),
                entryFileNames: "[name].mjs",
                format: "es",
                preserveModules: true,
                preserveModulesRoot: join(__dirname, "./src"),
                globals: {
                    "process.env.ES": "true",
                },
            },
            {
                dir: join(__dirname, "./dist/"),
                entryFileNames: "[name].js",
                format: "cjs",
                preserveModules: true,
                preserveModulesRoot: join(__dirname, "./src"),
                globals: {
                    "process.env.ES": "false",
                },
            },
        ],
    },
];
