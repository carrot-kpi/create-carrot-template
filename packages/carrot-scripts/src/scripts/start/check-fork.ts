import ora from "ora";
import * as chainsObject from "viem/chains";
import type { Chain, PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { ChainId } from "@carrot-kpi/sdk";

const chains = Object.values(chainsObject);

export interface CheckForkReturnValue {
    forkPublicClient: PublicClient;
    forkedChain: Chain;
}

export const checkFork = async (
    forkUrl: string,
): Promise<CheckForkReturnValue> => {
    const forkCheckSpinner = ora();
    forkCheckSpinner.start(`Checking forked network chain id`);
    let forkedChain: Chain, forkPublicClient: PublicClient;
    try {
        forkPublicClient = createPublicClient({
            transport: http(forkUrl),
        });
        const chainId = await forkPublicClient.getChainId();
        const chain = chains.find((chain) => chain.id === chainId) as
            | Chain
            | undefined;
        if (!(chainId in ChainId) || !chain) {
            forkCheckSpinner.fail(`Incompatible forked chain id ${chainId}`);
            console.log();
            console.log(
                "Compatible chain ids are:",
                Object.values(ChainId).join(", "),
            );

            process.exit(0);
        }
        forkedChain = chain;
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
