#!/usr/bin/env node

// TODO: split subcommands across various files

import { mnemonicToAccount } from "viem/accounts";
import {
    createWalletClient,
    createPublicClient,
    http,
    getContract,
    parseUnits,
    bytesToHex,
    createTestClient,
    formatUnits,
} from "viem";
import type { Address, Hex, Chain, PublicClient, WalletClient } from "viem";
import {
    ChainId,
    CHAIN_ADDRESSES,
    FACTORY_ABI,
    KPI_TOKENS_MANAGER_ABI,
    ORACLES_MANAGER_ABI,
} from "@carrot-kpi/sdk";
import ora from "ora";
import chalk from "chalk";
import ganache from "@carrot-kpi/ganache";
import { join, resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { homedir } from "os";
import { Writable } from "stream";
import * as chainsObject from "viem/chains";
import { $ } from "execa";
import { createIPFSDaemon } from "../ipfs-daemon/createIPFSDaemon.js";
import { create as createIPFSClient } from "ipfs-http-client";

export const clearConsole = () => {
    if (process.stdout.isTTY)
        process.stdout.write(
            process.platform === "win32"
                ? "\x1B[2J\x1B[0f"
                : "\x1B[2J\x1B[3J\x1B[H"
        );
};

const chains = Object.values(chainsObject);

const NODE_PORT = 9001;
const IPFS_GATEWAY_API_PORT = 9090;
const IPFS_HTTP_API_PORT = 5002;
const IPFS_RPC_API_PORT = 5003;
const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const IPFS_REPO_PATH = join(homedir(), ".cct/ipfs");

interface CustomContract {
    name: string;
    address: Address;
}

const printInformation = (
    deploymentAccountAddress: Address,
    deploymentAccountSecretKey: Hex,
    deploymentAccountInitialBalance: string,
    factoryAddress: Address,
    kpiTokensManagerAddress: Address,
    oraclesManagerAddress: Address,
    multicallAddress: Address | undefined,
    templateContractAddress: Address,
    customContracts: CustomContract[]
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
    console.log(`  http://127.0.0.1:${NODE_PORT}`);
    console.log(`  ws://127.0.0.1:${NODE_PORT}`);
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
    if (multicallAddress) console.log("  Multicall:", multicallAddress);
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
                Object.values(ChainId).join(", ")
            );

            process.exit(0);
        }
        forkedChain = chain;
        forkCheckSpinner.succeed(
            `Compatible forked chain id ${forkedChain.id}`
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
        await $`yarn build:contracts`;
        compileSpinner.succeed("Contracts compiled");
    } catch (error) {
        compileSpinner.fail("Could not compile contracts");
        console.log();
        console.log(error);
        process.exit(1);
    }

    const nodeSpinner = ora();
    nodeSpinner.start(
        `Starting up local node with fork URL ${forkUrl} and chain id ${forkedChain.id}`
    );
    const chainAddresses = CHAIN_ADDRESSES[forkedChain.id as ChainId];
    let nodeClient: PublicClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        walletClient: WalletClient,
        secretKey: Hex,
        deploymentAccountInitialBalance: bigint;
    try {
        const ganacheServer = ganache.server({
            fork: { url: forkUrl, deleteCache: true, disableCache: true },
            chain: {
                chainId: forkedChain.id,
            },
            wallet: {
                totalAccounts: 0,
            },
            logging: {
                quiet: true,
            },
        });
        await new Promise<void>((resolve, reject) => {
            ganacheServer.once("open").then(() => {
                resolve();
            });
        });

        const nodeTransport = http(`http://127.0.0.1:${NODE_PORT}`);
        nodeClient = createPublicClient({
            transport: nodeTransport,
        });

        const account = mnemonicToAccount(MNEMONIC, {
            path: DERIVATION_PATH,
        });
        secretKey = bytesToHex(account.getHdKey().privateKey!);
        walletClient = createWalletClient({
            account: account,
            transport: nodeTransport,
            chain: forkedChain,
        });

        const testClient = createTestClient({
            mode: "ganache",
            transport: nodeTransport,
        });

        // for some reason, even though we use the same mnemonic and derivation path as anvil,
        // the resulting account is different. So, the account derivation from the mnemonic
        // and derivation path is kept to keep things consistent, but it's required to deal
        // some eth directly to the different account through an anvil sepcific method.
        await testClient.setBalance({
            address: account.address,
            value: parseUnits("1000", forkedChain.nativeCurrency.decimals),
        });

        deploymentAccountInitialBalance = await nodeClient.getBalance({
            address: account.address,
        });

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

        await testClient.impersonateAccount({ address: kpiTokensManagerOwner });
        await testClient.impersonateAccount({ address: oraclesManagerOwner });

        nodeSpinner.succeed(`Started up local node with fork URL ${forkUrl}`);
    } catch (error) {
        nodeSpinner.fail(
            `Could not start up node with fork URL ${forkUrl} and chain id ${forkedChain.id}`
        );
        console.log();
        console.log(error);
        process.exit(1);
    }

    const ipfsNodeSpinner = ora();
    ipfsNodeSpinner.start("Starting up local IPFS node");
    let specificationCid;
    try {
        const configPath = join(IPFS_REPO_PATH, "./config");
        if (existsSync(IPFS_REPO_PATH))
            rmSync(IPFS_REPO_PATH, {
                force: true,
                recursive: true,
            });

        mkdirSync(IPFS_REPO_PATH, {
            recursive: true,
        });
        await $({ env: { IPFS_PATH: IPFS_REPO_PATH } })`ipfs init`;
        const jsonConfig = readFileSync(configPath, "utf8");
        const config = JSON.parse(jsonConfig);
        config.Addresses.API = `/ip4/127.0.0.1/tcp/${IPFS_HTTP_API_PORT}`;
        config.Addresses.Gateway = `/ip4/127.0.0.1/tcp/${IPFS_GATEWAY_API_PORT}`;
        config.API.HTTPHeaders = { "Access-Control-Allow-Origin": ["*"] };
        config.Peering = {
            Peers: [
                {
                    ID: "12D3KooWAijC3pWzCQsRaeNsmGE6NK2UfHgc1rD28L2kuYRV5ghE",
                    Addrs: [
                        "/ip4/146.190.184.28/tcp/4001",
                        "/ip4/146.190.184.28/udp/4001/quic",
                    ],
                },
                {
                    ID: "12D3KooWCUPbbhRFbuHZD8LWVBD7gqYHN7AbVhfsbPgd4zZonZQL",
                    Addrs: [
                        "/ip4/143.244.212.32/tcp/4001",
                        "/ip4/143.244.212.32/udp/4001/quic",
                    ],
                },
            ],
        };
        writeFileSync(configPath, JSON.stringify(config, null, 4));

        const ipfsDaemon = createIPFSDaemon({ repoPath: IPFS_REPO_PATH });
        await ipfsDaemon.start();

        const ipfsClient = createIPFSClient({
            url: `http://127.0.0.1:${IPFS_HTTP_API_PORT}`,
        });

        const specificationContent = JSON.parse(
            readFileSync(specificationLocation).toString()
        );
        const result = await ipfsClient.add(
            {
                path: "./base.json",
                // parse and stringify instead of using the spec file
                // directly in order to minify the json spec
                content: JSON.stringify(specificationContent),
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
        templateAddress: Address,
        customContracts: CustomContract[],
        frontendGlobals,
        predictedTemplateId;
    try {
        factory = getContract({
            address: chainAddresses.factory,
            abi: FACTORY_ABI,
            walletClient,
        });

        const isKpiTokenTemplate =
            JSON.parse(readFileSync(pkgLocation, "utf-8")).templateType ===
            "kpi-token";
        const templatesManager = isKpiTokenTemplate
            ? kpiTokensManager
            : oraclesManager;

        predictedTemplateId = Number(
            await templatesManager.read.nextTemplateId()
        );
        const { setupFork } = await import(setupForkScriptLocation);
        const setupResult = await setupFork({
            forkedChain,
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
            chain: forkedChain,
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
            forkedChain.id,
            predictedTemplateId,
            secretKey,
            Object.entries(frontendGlobals).reduce(
                (accumulator: Record<string, string>, [key, rawValue]) => {
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
                    CCT_CHAIN_ID: JSON.stringify(forkedChain.id),
                    CCT_TEMPLATE_ID: JSON.stringify(predictedTemplateId),
                    CCT_TEMPLATE_ADDRESS: JSON.stringify(templateAddress),
                    CCT_DEPLOYMENT_ACCOUNT_PRIVATE_KEY:
                        JSON.stringify(secretKey),
                    CCT_DEPLOYMENT_ACCOUNT_ADDRESS: JSON.stringify(
                        walletClient.account!.address
                    ),
                }
            ),
            new Writable({
                write(chunk, _, callback) {
                    clearConsole();
                    printInformation(
                        walletClient.account!.address,
                        secretKey,
                        formatUnits(
                            deploymentAccountInitialBalance,
                            forkedChain.nativeCurrency.decimals
                        ),
                        chainAddresses.factory,
                        chainAddresses.kpiTokensManager,
                        chainAddresses.oraclesManager,
                        forkedChain.contracts?.multicall3?.address,
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
