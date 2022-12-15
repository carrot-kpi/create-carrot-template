import { dirname, join } from "path";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { terser } from "rollup-plugin-terser";
import { fileURLToPath } from "url";
import glob from "glob";
import { createRequire } from "module";
import shebang from "rollup-plugin-preserve-shebang";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { dependencies } = require("./package.json");
const external = Object.keys(dependencies);

export default [
    {
        input: glob.sync(join(__dirname, "./src/**/*.js")),
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
