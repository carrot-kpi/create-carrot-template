import {
    CHAIN_ADDRESSES,
    ChainId,
    KPI_TOKENS_MANAGER_ABI,
    ORACLES_MANAGER_ABI,
} from "@carrot-kpi/sdk";
import ora from "ora";
import type {
    Chain,
    Hex,
    Address,
    PublicClient,
    WalletClient,
    GetContractReturnType,
} from "viem";
import {
    createPublicClient,
    http,
    createWalletClient,
    getContract,
} from "viem";
import ganache from "@carrot-kpi/ganache";
import { privateKeyToAccount } from "viem/accounts";

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
        PublicClient,
        WalletClient
    >;
    kpiTokensManagerOwner: Address;
    oraclesManager: GetContractReturnType<
        typeof ORACLES_MANAGER_ABI,
        PublicClient,
        WalletClient
    >;
    oraclesManagerOwner: Address;
    port: number;
}

export const startLocalNode = async (
    forkURL: string,
    forkPublicClient: PublicClient,
    forkedChain: Chain
): Promise<StartLocalNodeReturnValue> => {
    const nodeSpinner = ora();
    nodeSpinner.start(
        `Starting up local node with fork URL ${forkURL} and chain id ${forkedChain.id}`
    );
    const chainAddresses = CHAIN_ADDRESSES[forkedChain.id as ChainId];
    let localNodeClient: PublicClient,
        kpiTokensManager,
        kpiTokensManagerOwner,
        oraclesManager,
        oraclesManagerOwner,
        mainAccountWalletClient: WalletClient,
        mainAccountSecretKey: Hex,
        mainAccountInitialBalance: bigint;
    try {
        kpiTokensManagerOwner = await forkPublicClient.readContract({
            address: chainAddresses.kpiTokensManager,
            abi: KPI_TOKENS_MANAGER_ABI,
            functionName: "owner",
        });
        oraclesManagerOwner = await forkPublicClient.readContract({
            address: chainAddresses.oraclesManager,
            abi: KPI_TOKENS_MANAGER_ABI,
            functionName: "owner",
        });

        const ganacheServer = ganache.server({
            fork: { url: forkURL, deleteCache: true },
            chain: {
                chainId: forkedChain.id,
            },
            wallet: {
                totalAccounts: 1,
                mnemonic: MNEMONIC,
                hdPath: DERIVATION_PATH,
                unlockedAccounts: [kpiTokensManagerOwner, oraclesManagerOwner],
            },
            logging: {
                quiet: true,
            },
        });
        await new Promise<void>((resolve, reject) => {
            ganacheServer.once("open").then(resolve);
            ganacheServer.listen(PORT).catch(reject);
        });
        const nodeTransport = http(`http://127.0.0.1:${PORT}`);
        localNodeClient = createPublicClient({
            transport: nodeTransport,
        });

        const initialAccounts =
            await ganacheServer.provider.getInitialAccounts();
        const [accountAddress, initialAccount] =
            Object.entries(initialAccounts)[0];

        mainAccountSecretKey = initialAccount.secretKey as Hex;
        const account = privateKeyToAccount(mainAccountSecretKey);
        mainAccountWalletClient = createWalletClient({
            account,
            transport: nodeTransport,
            chain: forkedChain,
        });

        mainAccountInitialBalance = await localNodeClient.getBalance({
            address: accountAddress as Address,
        });

        kpiTokensManager = getContract({
            address: chainAddresses.kpiTokensManager,
            abi: KPI_TOKENS_MANAGER_ABI,
            walletClient: mainAccountWalletClient,
            publicClient: localNodeClient,
        });
        oraclesManager = getContract({
            address: chainAddresses.oraclesManager,
            abi: ORACLES_MANAGER_ABI,
            walletClient: mainAccountWalletClient,
            publicClient: localNodeClient,
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
            `Could not start up node with fork URL ${forkURL} and chain id ${forkedChain.id}`
        );
        console.log();
        console.log(error);
        process.exit(1);
    }
};
