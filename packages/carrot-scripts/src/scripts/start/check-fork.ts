import ora from "ora";
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { ChainId, SUPPORTED_CHAIN, type SupportedChain } from "@carrot-kpi/sdk";

export interface CheckForkReturnValue {
    forkPublicClient: PublicClient;
    forkedChain: SupportedChain;
}

export const checkFork = async (
    forkUrl: string,
): Promise<CheckForkReturnValue> => {
    const forkCheckSpinner = ora();
    forkCheckSpinner.start(`Checking forked network chain id`);
    let forkedChain: SupportedChain, forkPublicClient: PublicClient;
    try {
        forkPublicClient = createPublicClient({
            transport: http(forkUrl),
        });
        const chainId = await forkPublicClient.getChainId();
        const supportedChain = Object.values(SUPPORTED_CHAIN).find(
            (supportedChain) => supportedChain.id === chainId,
        );
        if (!supportedChain) {
            forkCheckSpinner.fail(`Incompatible forked chain id ${chainId}`);
            console.log();
            console.log(
                "Compatible chain ids are:",
                Object.values(ChainId).join(", "),
            );

            process.exit(0);
        }
        forkedChain = supportedChain;
        forkCheckSpinner.succeed(
            `Compatible forked chain id ${forkedChain.id}`,
        );

        return { forkPublicClient, forkedChain };
    } catch (error) {
        forkCheckSpinner.fail(
            `Error determining the forked chain id. Maybe your fork URL is malformed?`,
        );
        console.log();
        console.log(error);
        process.exit(1);
    }
};
