#!/usr/bin/env node

import { execaNode } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AVAILABLE_SCRIPTS = ["start"];

const args = process.argv.slice(2);

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

execaNode(
    join(dirname(fileURLToPath(import.meta.url)), "./scripts", `${script}.js`),
    remainingArgs,
    { stdio: "inherit" }
);
