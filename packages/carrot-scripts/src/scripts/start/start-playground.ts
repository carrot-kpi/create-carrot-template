import {
    Address,
    Chain,
    Hex,
    PublicClient,
    WalletClient,
    formatUnits,
} from "viem";
import { resolve } from "path";
import ora from "ora";
import { DeployTemplateReturnValue } from "./deploy-template";
import { Writable } from "stream";
import { clearConsole } from "../../utils/index.js";
import chalk from "chalk";
import { CHAIN_ADDRESSES, ChainId } from "@carrot-kpi/sdk";

const START_SCRIPT_LOCATION = resolve(
    "./packages/frontend/.cct/start-playground.js",
);

const printInformation = (
    deploymentAccountAddress: Address,
    deploymentAccountSecretKey: Hex,
    deploymentAccountInitialBalance: string,
    factoryAddress: Address,
    kpiTokensManagerAddress: Address,
    oraclesManagerAddress: Address,
    multicallAddress: Address | undefined,
    templateContractAddress: Address,
    customContracts: DeployTemplateReturnValue["customContracts"],
    localNodePort: number,
    gatewayPort: number,
    httpAPIPort: number,
    rpcAPIPort: number,
) => {
    console.log(
        chalk.green(
            "Local playground successfully started up on target network!",
        ),
    );
    console.log();
    console.log(chalk.cyan("Used chain-setup account:"));
    console.log();
    console.log("  Address:", deploymentAccountAddress);
    console.log("  Private key:", deploymentAccountSecretKey);
    console.log("  Initial balance:", deploymentAccountInitialBalance);
    console.log();
    console.log(chalk.cyan("RPC endpoints:"));
    console.log();
    console.log(`  http://127.0.0.1:${localNodePort}`);
    console.log(`  ws://127.0.0.1:${localNodePort}`);
    console.log();
    console.log(chalk.cyan("IPFS endpoints:"));
    console.log();
    console.log(`  - Gateway: http://127.0.0.1:${gatewayPort}`);
    console.log(`  - HTTP API: http://127.0.0.1:${httpAPIPort}`);
    console.log(`  - RPC API: http://127.0.0.1:${rpcAPIPort}`);
    console.log();
    console.log(chalk.cyan("Contract addresses:"));
    console.log();
    console.log("  KPI tokens factory:", factoryAddress);
    console.log("  KPI tokens manager:", kpiTokensManagerAddress);
    console.log("  Oracles manager:", oraclesManagerAddress);
    if (multicallAddress) console.log("  Multicall:", multicallAddress);
    console.log("  Template:", templateContractAddress);
    if (customContracts)
        customContracts.map(({ name, address }) => {
            console.log(`  ${name}:`, address);
        });
    console.log();
    console.log(chalk.cyan("Frontend log:"));
};

export const startPlayground = async (
    forkedChain: Chain,
    predictedTemplateId: number,
    mainAccountSecretKey: Hex,
    frontendGlobals: DeployTemplateReturnValue["frontendGlobals"],
    customContracts: DeployTemplateReturnValue["customContracts"],
    localNodeClient: PublicClient,
    mainAccountWalletClient: WalletClient,
    templateAddress: Address,
    localNodePort: number,
    ipfsGatewayPort: number,
    ipfsHttpAPIPort: number,
    ipfsRpcAPIPort: number,
    deploymentAccountInitialBalance: bigint,
) => {
    const chainAddresses = CHAIN_ADDRESSES[forkedChain.id as ChainId];

    const frontendSpinner = ora();
    frontendSpinner.start("Starting up local playground");
    try {
        const { startPlayground } = await import(START_SCRIPT_LOCATION);
        process.chdir("packages/frontend");
        await startPlayground(
            forkedChain.id,
            predictedTemplateId,
            mainAccountSecretKey,
            Object.entries(frontendGlobals).reduce(
                (accumulator: Record<string, string>, [key, rawValue]) => {
                    accumulator[key] = JSON.stringify(rawValue);
                    return accumulator;
                },
                {
                    __DEV__: JSON.stringify(true),
                    CCT_RPC_URL: JSON.stringify(localNodeClient.transport.url),
                    CCT_IPFS_GATEWAY_URL: JSON.stringify(
                        `http://127.0.0.1:${ipfsGatewayPort}`,
                    ),
                    CCT_IPFS_HTTP_API_URL: JSON.stringify(
                        `http://127.0.0.1:${ipfsHttpAPIPort}`,
                    ),
                    CCT_IPFS_RPC_API_URL: JSON.stringify(
                        `http://127.0.0.1:${ipfsRpcAPIPort}`,
                    ),
                    CCT_CHAIN_ID: JSON.stringify(forkedChain.id),
                    CCT_TEMPLATE_ID: JSON.stringify(predictedTemplateId),
                    CCT_TEMPLATE_ADDRESS: JSON.stringify(templateAddress),
                    CCT_DEPLOYMENT_ACCOUNT_PRIVATE_KEY:
                        JSON.stringify(mainAccountSecretKey),
                    CCT_DEPLOYMENT_ACCOUNT_ADDRESS: JSON.stringify(
                        mainAccountWalletClient.account!.address,
                    ),
                },
            ),
            new Writable({
                write(chunk, _, callback) {
                    clearConsole();
                    printInformation(
                        mainAccountWalletClient.account!.address,
                        mainAccountSecretKey,
                        formatUnits(
                            deploymentAccountInitialBalance,
                            forkedChain.nativeCurrency.decimals,
                        ),
                        chainAddresses.factory,
                        chainAddresses.kpiTokensManager,
                        chainAddresses.oraclesManager,
                        forkedChain.contracts?.multicall3?.address,
                        templateAddress,
                        customContracts,
                        localNodePort,
                        ipfsGatewayPort,
                        ipfsHttpAPIPort,
                        ipfsRpcAPIPort,
                    );
                    console.log();
                    console.log(chunk.toString().replace(/^/gm, `  `));
                    callback();
                },
            }),
        );
        frontendSpinner.stop();
    } catch (error) {
        frontendSpinner.fail("Could not start up local playground");
        console.log();
        console.log(error);
        process.exit(1);
    }
};
