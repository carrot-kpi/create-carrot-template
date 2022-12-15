#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { createCarrotTemplate } from "./main.js";
import fsExtra from "fs-extra";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const pkg = fsExtra.readJSONSync(
    join(dirname(fileURLToPath(import.meta.url)), "../package.json")
);

new Command(pkg.name)
    .version(pkg.version)
    .arguments("[project-directory]")
    .usage(`${chalk.green("<project-directory>")} [options]`)
    .action(createCarrotTemplate)
    .option("-v, --verbose", "print additional logs")
    .option("-i, --info", "print environment debug info")
    .option("-k, --kpi-token", "create a KPI token template")
    .option("-o, --oracle", "create an oracle template")
    .option(
        "-fp, --frontend-preset <frontend-preset-name>",
        "specify a preset for the template frontend"
    )
    .option(
        "-cp, --contracts-preset <contracts-preset-name>",
        "specify a preset for the template contracts"
    )
    .on("--help", () => {
        console.log(
            `    ${chalk.green("<project-directory>")} and one of ${chalk.green(
                "--kpi-token"
            )} or ${chalk.green("--oracle")} are required.`
        );
        console.log();
        console.log(
            "    Custom presets can be used for both smart contracts and frontend, " +
                "combining them in different ways based on the tech stack each developer wants to use. " +
                `Selecting custom presets can be done using the ${chalk.cyan(
                    "--frontend-preset"
                )} and ${chalk.cyan(
                    "--contracts-preset"
                )} flags. All the options will be available here soon`
        );
        console.log();
        console.log(
            `    If you have any problems, do not hesitate to file an issue:`
        );
        console.log(
            `      ${chalk.cyan(
                "https://github.com/carrot-kpi/create-carrot-template/issues/new"
            )}`
        );
        console.log();
    })
    .parseAsync(process.argv);
