import {
    SUPPORTED_CHAIN,
    SupportedChain,
    FACTORY_ABI,
    KPI_TOKENS_MANAGER_ABI,
    ORACLES_MANAGER_ABI,
} from "@carrot-kpi/sdk";
import ora from "ora";
import type {
    Hex,
    Address,
    PublicClient,
    WalletClient,
    GetContractReturnType,
} from "viem";
import {
    http,
    createWalletClient,
    getContract,
    parseEther,
    createPublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAnvil } from "@viem/anvil";
import { Contract, providers } from "ethers";

const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const PORT = 9001;

export interface StartLocalNodeReturnValue {
    localNodeClient: PublicClient;
    mainAccountWalletClient: WalletClient;
    mainAccountSecretKey: Hex;
    mainAccountInitialBalance: bigint;
    kpiTokensManager: GetContractReturnType<
        typeof KPI_TOKENS_MANAGER_ABI,
        WalletClient
    >;
    kpiTokensManagerOwner: Address;
    oraclesManager: GetContractReturnType<
        typeof ORACLES_MANAGER_ABI,
        WalletClient
    >;
    oraclesManagerOwner: Address;
    port: number;
}

export const startLocalNode = async (
    forkURL: string,
    forkPublicClient: PublicClient,
    forkedChain: SupportedChain,
): Promise<StartLocalNodeReturnValue> => {
    const nodeSpinner = ora();
    nodeSpinner.start(
        `Starting up local node with fork URL ${forkURL} and chain id ${forkedChain.id}`,
    );
    const chainAddresses = SUPPORTED_CHAIN[forkedChain.id];
    let localNodeClient: PublicClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        mainAccountWalletClient: WalletClient,
        mainAccountSecretKey: Hex,
        mainAccountInitialBalance: bigint;
    try {
        const kpiTokensFactoryOwner = await forkPublicClient.readContract({
            address: chainAddresses.contracts.factory.address,
            abi: FACTORY_ABI,
            functionName: "owner",
        });
        kpiTokensManagerOwner = await forkPublicClient.readContract({
            address: chainAddresses.contracts.kpiTokensManager.address,
            abi: KPI_TOKENS_MANAGER_ABI,
            functionName: "owner",
        });
        oraclesManagerOwner = await forkPublicClient.readContract({
            address: chainAddresses.contracts.oraclesManager.address,
            abi: KPI_TOKENS_MANAGER_ABI,
            functionName: "owner",
        });

        const anvil = createAnvil({
            port: PORT,
            forkUrl: forkURL,
            noStorageCaching: true,
            chainId: forkedChain.id,
            forkChainId: forkedChain.id,
            mnemonic: MNEMONIC,
            derivationPath: DERIVATION_PATH,
            accounts: 1,
            forkBlockNumber: await forkPublicClient.getBlockNumber(),
            host: "0.0.0.0",
        });

        await anvil.start();
        const nodeTransport = http(`http://127.0.0.1:${PORT}`);
        localNodeClient = createPublicClient({
            transport: nodeTransport,
            chain: forkedChain,
        });

        mainAccountSecretKey =
            "0x3676a8cf8bac6b3094dc63fffc187d688f0ebe2eaf3a23a6d01e50fbfd39ff1e" as Hex;
        const account = privateKeyToAccount(mainAccountSecretKey);

        mainAccountWalletClient = createWalletClient({
            account,
            transport: nodeTransport,
            chain: forkedChain,
        });

        const testClient = new providers.JsonRpcProvider(
            `http://127.0.0.1:${PORT}`,
            forkedChain.id,
        );
        // just in case, deal some eth to the manager owners
        await testClient.send("anvil_setBalance", [
            kpiTokensManagerOwner,
            parseEther("100").toString(),
        ]);
        await testClient.send("anvil_setBalance", [
            oraclesManagerOwner,
            parseEther("100").toString(),
        ]);
        await testClient.send("anvil_autoImpersonateAccount", [true]);

        // allow the main account as a creator
        const factory = new Contract(
            chainAddresses.contracts.factory.address,
            FACTORY_ABI,
            await testClient.getSigner(kpiTokensFactoryOwner),
        );
        await factory.allowCreator(account.address);

        mainAccountInitialBalance = await localNodeClient.getBalance({
            address: account.address,
        });

        kpiTokensManager = getContract({
            address: chainAddresses.contracts.kpiTokensManager.address,
            abi: KPI_TOKENS_MANAGER_ABI,
            client: mainAccountWalletClient,
        });
        oraclesManager = getContract({
            address: chainAddresses.contracts.oraclesManager.address,
            abi: ORACLES_MANAGER_ABI,
            client: mainAccountWalletClient,
        });

        nodeSpinner.succeed(`Started up local node with fork URL ${forkURL}`);

        return {
            localNodeClient,
            kpiTokensManager,
            kpiTokensManagerOwner,
            oraclesManager,
            oraclesManagerOwner,
            mainAccountWalletClient,
            mainAccountSecretKey,
            mainAccountInitialBalance,
            port: PORT,
        };
    } catch (error) {
        nodeSpinner.fail(
            `Could not start up node with fork URL ${forkURL} and chain id ${forkedChain.id}`,
        );
        console.log();
        console.log(error);
        process.exit(1);
    }
};
