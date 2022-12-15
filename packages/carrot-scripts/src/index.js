#!/usr/bin/env node

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const AVAILABLE_SCRIPTS = ["start"];

const args = process.argv.slice(2);
const __dirname = dirname(fileURLToPath(import.meta.url));

const scriptIndex = args.findIndex((arg) => AVAILABLE_SCRIPTS.includes(arg));
if (scriptIndex === -1) {
    console.log("No script specified. The available scripts are:");
    AVAILABLE_SCRIPTS.forEach((script) => {
        console.log(`  - ${script}`);
    });
    console.log("Perhaps you need to update carrot-scripts?");
    process.exit(0);
}
const script = args[scriptIndex];
const remainingArgs =
    scriptIndex > 0 ? args.splice(scriptIndex, 1) : args.slice(1);

execSync(
    `node ${join(
        __dirname,
        "./scripts",
        `${script}.${process.env.ES === true ? "mjs" : "js"}`
    )} ${remainingArgs.join(" ")}`,
    { stdio: "inherit" }
);
