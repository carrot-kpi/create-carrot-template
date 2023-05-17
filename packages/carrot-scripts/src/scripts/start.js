#!/usr/bin/env node

import { execSync } from "child_process";
import { mnemonicToAccount } from "viem/accounts";
import {
    createWalletClient,
    createPublicClient,
    http,
    formatEther,
    getContract,
    parseUnits,
    toHex,
    bytesToHex,
} from "viem";
import {
    ChainId,
    CHAIN_ADDRESSES,
    FACTORY_ABI,
    KPI_TOKENS_MANAGER_ABI,
    ORACLES_MANAGER_ABI,
    MULTICALL_ABI,
} from "@carrot-kpi/sdk";
import ora from "ora";
import chalk from "chalk";
import { createAnvil } from "@viem/anvil";
import { create as createIPFSClient } from "ipfs";
import { HttpGateway } from "ipfs-http-gateway";
import { HttpApi } from "ipfs-http-server";
import { clearConsole } from "../utils/index.js";
import { join, resolve } from "path";
import { existsSync, readFileSync, rmSync } from "fs";
import { homedir } from "os";
import { Writable } from "stream";
import { long as longCommitHash } from "git-rev-sync";
import * as chainsObject from "viem/chains";

const chains = Object.values(chainsObject);

const ANVIL_PORT = 9001;
const IPFS_GATEWAY_API_PORT = 9090;
const IPFS_HTTP_API_PORT = 5002;
const IPFS_RPC_API_PORT = 5003;
const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const IPFS_REPO_PATH = join(homedir(), ".cct/ipfs");

const printInformation = (
    deploymentAccountAddress,
    deploymentAccountSecretKey,
    deploymentAccountInitialBalance,
    factoryAddress,
    kpiTokensManagerAddress,
    oraclesManagerAddress,
    multicallAddress,
    templateContractAddress,
    customContracts
) => {
    console.log(
        chalk.green(
            "Local playground successfully started up on target network!"
        )
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
    console.log(`  http://127.0.0.1:${ANVIL_PORT}`);
    console.log(`  ws://127.0.0.1:${ANVIL_PORT}`);
    console.log();
    console.log(chalk.cyan("IPFS endpoints:"));
    console.log();
    console.log(`  - Gateway: http://127.0.0.1:${IPFS_GATEWAY_API_PORT}`);
    console.log(`  - HTTP API: http://127.0.0.1:${IPFS_HTTP_API_PORT}`);
    console.log(`  - RPC API: http://127.0.0.1:${IPFS_RPC_API_PORT}`);
    console.log();
    console.log(chalk.cyan("Contract addresses:"));
    console.log();
    console.log("  KPI tokens factory:", factoryAddress);
    console.log("  KPI tokens manager:", kpiTokensManagerAddress);
    console.log("  Oracles manager:", oraclesManagerAddress);
    console.log("  Multicall:", multicallAddress);
    console.log("  Template:", templateContractAddress);
    if (customContracts)
        customContracts.map(({ name, address }) => {
            console.log(`  ${name}:`, address);
        });
    console.log();
    console.log(chalk.cyan("Frontend log:"));
};

const [forkUrl] = process.argv.slice(2);
if (!forkUrl) {
    console.error("Please specify an RPC endpoint to fork from.");
    console.error("If invoking directly:");
    console.log(
        `  ${chalk.cyan("carrot-scripts")} start ${chalk.green(
            "<rpc-endpoint>"
        )}`
    );
    console.log("  or if invoking from a Carrot Create Template project:");
    console.log(
        `  ${chalk.cyan("yarn start")} ${chalk.green("<rpc_endpoint>")}`
    );
    process.exit(0);
}

const pkgLocation = resolve("./package.json");
const setupForkScriptLocation = resolve(
    "./packages/contracts/.cct/setup-fork.js"
);
const specificationLocation = resolve("./packages/frontend/src/base.json");
const startPlaygroundScriptLocation = resolve(
    "./packages/frontend/.cct/start-playground.js"
);

const main = async () => {
    clearConsole();

    const forkCheckSpinner = ora();
    forkCheckSpinner.start(`Checking forked network chain id`);
    let forkedNetworkChainId, forkedNetworkChain, forkNetworkClient;
    try {
        forkNetworkClient = createPublicClient({
            transport: http(forkUrl),
        });
        forkedNetworkChainId = await forkNetworkClient.getChainId();
        forkedNetworkChain = chains.find(
            (chain) => chain.id === forkedNetworkChainId
        );
        if (!(forkedNetworkChainId in ChainId) || !forkedNetworkChain) {
            forkCheckSpinner.fail(
                `Incompatible forked chain id ${forkedNetworkChainId}`
            );
            console.log();
            console.log(
                "Compatible chain ids are:",
                Object.values(ChainId)
                    .filter((chainId) => !isNaN(chainId))
                    .join(", ")
            );

            process.exit(0);
        }
        forkCheckSpinner.succeed(
            `Compatible forked chain id ${forkedNetworkChainId}`
        );
    } catch (error) {
        forkCheckSpinner.fail(
            `Error determining the forked chain id. Maybe your fork URL is malformed?`
        );
        console.log();
        console.log(error);
        process.exit(1);
    }

    const compileSpinner = ora();
    compileSpinner.start(`Compiling contracts`);
    try {
        execSync("yarn build:contracts");
        compileSpinner.succeed("Contracts compiled");
    } catch (error) {
        compileSpinner.fail("Could not compile contracts");
        console.log();
        console.log(error);
        process.exit(1);
    }

    const nodeSpinner = ora();
    nodeSpinner.start(
        `Starting up local node with fork URL ${forkUrl} and chain id ${forkedNetworkChainId}`
    );
    const chainAddresses = CHAIN_ADDRESSES[forkedNetworkChainId];
    let nodeClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        walletClient,
        secretKey,
        deploymentAccountInitialBalance;
    try {
        const anvil = createAnvil({
            silent: false,
            forkUrl,
            noStorageCaching: true,
            forkChainId: forkedNetworkChainId,
            chainId: forkedNetworkChainId,
            forkBlockNumber: await forkNetworkClient.getBlockNumber(),
            mnemonic: MNEMONIC,
            derivationPath: DERIVATION_PATH,
            accounts: 1,
            port: ANVIL_PORT,
            host: "127.0.0.1",
        });
        await anvil.start();

        const nodeTransport = http(`http://127.0.0.1:${ANVIL_PORT}`);
        nodeClient = createPublicClient({
            transport: nodeTransport,
        });
        await nodeClient.request({
            method: "anvil_autoImpersonateAccount",
            params: [true],
        });

        const account = mnemonicToAccount(MNEMONIC, {
            path: DERIVATION_PATH,
        });
        secretKey = bytesToHex(account.getHdKey().privateKey);
        walletClient = createWalletClient({
            account,
            transport: nodeTransport,
            chain: forkedNetworkChain,
        });

        // for some reason, even though we use the same mnemonic and derivation path as anvil,
        // the resulting account is different. So, the account derivation from the mnemonic
        // and derivation path is kept to keep things consistent, but it's required to deal
        // some eth directly to the different account through an anvil sepcific method.
        await nodeClient.request({
            method: "anvil_setBalance",
            params: [
                account.address,
                toHex(
                    parseUnits(
                        "1000",
                        forkedNetworkChain.nativeCurrency.decimals
                    )
                ),
            ],
        });

        deploymentAccountInitialBalance = formatEther(
            await nodeClient.getBalance({
                address: walletClient.account.address,
            })
        );

        kpiTokensManager = getContract({
            address: chainAddresses.kpiTokensManager,
            abi: KPI_TOKENS_MANAGER_ABI,
            walletClient,
            publicClient: nodeClient,
        });
        kpiTokensManagerOwner = await kpiTokensManager.read.owner();

        oraclesManager = getContract({
            address: chainAddresses.oraclesManager,
            abi: ORACLES_MANAGER_ABI,
            walletClient,
            publicClient: nodeClient,
        });
        oraclesManagerOwner = await oraclesManager.read.owner();

        nodeSpinner.succeed(`Started up local node with fork URL ${forkUrl}`);
    } catch (error) {
        nodeSpinner.fail(
            `Could not start up node with fork URL ${forkUrl} and chain id ${forkedNetworkChainId}`
        );
        console.log();
        console.log(error);
        process.exit(1);
    }

    const ipfsNodeSpinner = ora();
    ipfsNodeSpinner.start("Starting up local IPFS node");
    let specificationCid;
    try {
        if (existsSync(IPFS_REPO_PATH))
            rmSync(IPFS_REPO_PATH, {
                force: true,
                recursive: true,
            });
        const ipfs = await createIPFSClient({
            silent: true,
            repo: IPFS_REPO_PATH,
            config: {
                Addresses: {
                    API: `/ip4/127.0.0.1/tcp/${IPFS_HTTP_API_PORT}`,
                    Gateway: `/ip4/127.0.0.1/tcp/${IPFS_GATEWAY_API_PORT}`,
                },
                API: {
                    HTTPHeaders: {
                        "Access-Control-Allow-Origin": ["*"],
                    },
                },
            },
        });

        await new HttpGateway(ipfs).start();
        await new HttpApi(ipfs).start();

        const specificationContent = JSON.parse(
            readFileSync(specificationLocation).toString()
        );
        const commitHash = longCommitHash(process.cwd());
        const result = await ipfs.add(
            {
                path: "./base.json",
                content: JSON.stringify({
                    ...specificationContent,
                    commitHash,
                }),
            },
            { wrapWithDirectory: true }
        );
        specificationCid = result.cid.toString();
        ipfsNodeSpinner.succeed("Started up local IPFS node");
    } catch (error) {
        ipfsNodeSpinner.fail("Could not start up local IPFS node");
        console.log();
        console.log(error);
        process.exit(1);
    }

    const templateDeploymentSpinner = ora();
    templateDeploymentSpinner.start(
        "Deploying and setting up custom template on target network"
    );
    let factory,
        multicall,
        templateAddress,
        customContracts,
        frontendGlobals,
        predictedTemplateId;
    try {
        factory = getContract({
            address: chainAddresses.factory,
            abi: FACTORY_ABI,
            walletClient,
        });
        multicall = getContract({
            address: chainAddresses.multicall,
            abi: MULTICALL_ABI,
            publicClient: nodeClient,
        });

        const isKpiTokenTemplate =
            JSON.parse(readFileSync(pkgLocation)).templateType === "kpi-token";
        const templatesManager = isKpiTokenTemplate
            ? kpiTokensManager
            : oraclesManager;

        predictedTemplateId = Number(
            await templatesManager.read.nextTemplateId()
        );
        const { setupFork } = await import(setupForkScriptLocation);
        const setupResult = await setupFork({
            forkedNetworkChain,
            factory,
            kpiTokensManager,
            oraclesManager,
            predictedTemplateId,
            nodeClient,
            walletClient,
        });
        templateAddress = setupResult.templateAddress;
        customContracts = setupResult.customContracts;
        frontendGlobals = setupResult.frontendGlobals;

        await walletClient.writeContract({
            address: isKpiTokenTemplate
                ? chainAddresses.kpiTokensManager
                : chainAddresses.oraclesManager,
            abi: KPI_TOKENS_MANAGER_ABI,
            functionName: "addTemplate",
            args: [templateAddress, specificationCid],
            account: isKpiTokenTemplate
                ? kpiTokensManagerOwner
                : oraclesManagerOwner,
        });

        templateDeploymentSpinner.succeed(
            "Custom template deployed and set up on target network"
        );
    } catch (error) {
        templateDeploymentSpinner.fail(
            "Could not deploy and set up custom template on target network"
        );
        console.log();
        console.log(error);
        process.exit(1);
    }

    const frontendSpinner = ora();
    frontendSpinner.start("Starting up local playground");
    try {
        const { startPlayground } = await import(startPlaygroundScriptLocation);
        process.chdir("packages/frontend");
        await startPlayground(
            forkedNetworkChainId,
            predictedTemplateId,
            secretKey,
            Object.entries(frontendGlobals).reduce(
                (accumulator, [key, rawValue]) => {
                    accumulator[key] = JSON.stringify(rawValue);
                    return accumulator;
                },
                {
                    __DEV__: JSON.stringify(true),
                    CCT_RPC_URL: JSON.stringify(nodeClient.transport.url),
                    CCT_IPFS_GATEWAY_URL: JSON.stringify(
                        `http://127.0.0.1:${IPFS_GATEWAY_API_PORT}`
                    ),
                    CCT_IPFS_HTTP_API_URL: JSON.stringify(
                        `http://127.0.0.1:${IPFS_HTTP_API_PORT}`
                    ),
                    CCT_IPFS_RPC_API_URL: JSON.stringify(
                        `http://127.0.0.1:${IPFS_RPC_API_PORT}`
                    ),
                    CCT_CHAIN_ID: JSON.stringify(forkedNetworkChainId),
                    CCT_TEMPLATE_ID: JSON.stringify(predictedTemplateId),
                    CCT_TEMPLATE_ADDRESS: JSON.stringify(templateAddress),
                    CCT_DEPLOYMENT_ACCOUNT_PRIVATE_KEY:
                        JSON.stringify(secretKey),
                    CCT_DEPLOYMENT_ACCOUNT_ADDRESS: JSON.stringify(
                        walletClient.account.address
                    ),
                }
            ),
            new Writable({
                write(chunk, _, callback) {
                    clearConsole();
                    printInformation(
                        walletClient.account.address,
                        secretKey,
                        deploymentAccountInitialBalance,
                        chainAddresses.factory,
                        chainAddresses.kpiTokensManager,
                        chainAddresses.oraclesManager,
                        chainAddresses.multicall,
                        templateAddress,
                        customContracts
                    );
                    console.log();
                    console.log(chunk.toString().replace(/^/gm, `  `));
                    callback();
                },
            })
        );
        frontendSpinner.stop();
    } catch (error) {
        frontendSpinner.fail("Could not start up local playground");
        console.log();
        console.log(error);
        process.exit(1);
    }
};

main().then();
