import { $ } from "execa";
import ora from "ora";

export const compileContracts = async () => {
    const compileSpinner = ora();
    compileSpinner.start(`Compiling contracts`);
    try {
        await $`yarn build:contracts`;
        compileSpinner.succeed("Contracts compiled");
    } catch (error) {
        compileSpinner.fail("Could not compile contracts");
        console.log();
        console.log(error);
        process.exit(1);
    }
};
