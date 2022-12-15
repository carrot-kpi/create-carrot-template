import { dirname, join } from "path";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
    {
        input: join(__dirname, "./src/scripts/*.js"),
        plugins: [nodeResolve(), commonjs(), terser()],
        output: [
            {
                dir: join(__dirname, "./dist/"),
                entryFileNames: "[name].mjs",
                format: "es",
                preserveModules: true,
                preserveModulesRoot: join(__dirname, "./src/scripts"),
            },
            {
                dir: join(__dirname, "./dist/"),
                entryFileNames: "[name].js",
                format: "cjs",
                preserveModules: true,
                preserveModulesRoot: join(__dirname, "./src/scripts"),
            },
        ],
    },
];
