#!/usr/bin/env node

import chalk from "chalk";
import { clearConsole } from "../../utils/index.js";
import { checkFork } from "./check-fork.js";
import { compileContracts } from "./compile-contracts.js";
import { startLocalNode } from "./start-local-node.js";
import { startIPFSNode } from "./start-ipfs-node.js";
import { deployTemplate } from "./deploy-template.js";
import { startPlayground } from "./start-playground.js";

const [forkUrl] = process.argv.slice(2);
if (!forkUrl) {
    console.error("Please specify an RPC endpoint to fork from.");
    console.error("If invoking directly:");
    console.log(
        `  ${chalk.cyan("carrot-scripts")} start ${chalk.green(
            "<rpc-endpoint>",
        )}`,
    );
    console.log("  or if invoking from a Carrot Create Template project:");
    console.log(
        `  ${chalk.cyan("yarn start")} ${chalk.green("<rpc_endpoint>")}`,
    );
    process.exit(0);
}

const main = async () => {
    clearConsole();

    const { forkPublicClient, forkedChain } = await checkFork(forkUrl);
    await compileContracts();
    const {
        localNodeClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        mainAccountWalletClient,
        mainAccountSecretKey,
        mainAccountInitialBalance,
        port: localNodePort,
    } = await startLocalNode(forkUrl, forkPublicClient, forkedChain);
    const {
        specificationCid,
        gatewayPort: ipfsGatewayPort,
        httpAPIPort: ipfsHttpAPIPort,
        rpcAPIPort: ipfsRpcAPIPort,
    } = await startIPFSNode();
    const {
        predictedTemplateId,
        customContracts,
        frontendGlobals,
        templateAddress,
    } = await deployTemplate(
        forkedChain,
        mainAccountWalletClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        localNodeClient,
        specificationCid,
        localNodePort,
    );
    await startPlayground(
        forkedChain,
        predictedTemplateId,
        mainAccountSecretKey,
        frontendGlobals,
        customContracts,
        localNodeClient,
        mainAccountWalletClient,
        templateAddress,
        localNodePort,
        ipfsGatewayPort,
        ipfsHttpAPIPort,
        ipfsRpcAPIPort,
        mainAccountInitialBalance,
    );
};

main().then();
