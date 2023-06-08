import {
    CHAIN_ADDRESSES,
    ChainId,
    FACTORY_ABI,
    KPI_TOKENS_MANAGER_ABI,
} from "@carrot-kpi/sdk";
import ora from "ora";
import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { getContract } from "viem";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Contract, providers } from "ethers";
import { StartLocalNodeReturnValue } from "./start-local-node";

const PACKAGE_JSON_LOCATION = resolve("./package.json");
const SETUP_FORK_SCRIPT_LOCATION = resolve(
    "./packages/contracts/.cct/setup-fork.js"
);

export interface DeployTemplateReturnValue {
    predictedTemplateId: number;
    templateAddress: Address;
    customContracts: CustomContract[];
    frontendGlobals: Record<string, unknown>;
}

export interface CustomContract {
    name: string;
    address: Address;
}

export const deployTemplate = async (
    forkedChain: Chain,
    deployerWalletClient: WalletClient,
    kpiTokensManager: StartLocalNodeReturnValue["kpiTokensManager"],
    kpiTokensManagerOwner: Address,
    oraclesManager: StartLocalNodeReturnValue["oraclesManager"],
    oraclesManagerOwner: Address,
    localNodeClient: PublicClient,
    specificationCid: string,
    port: number
): Promise<DeployTemplateReturnValue> => {
    const chainAddresses = CHAIN_ADDRESSES[forkedChain.id as ChainId];

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
            walletClient: deployerWalletClient,
        });

        const isKpiTokenTemplate =
            JSON.parse(readFileSync(PACKAGE_JSON_LOCATION, "utf-8"))
                .templateType === "kpi-token";

        const provider = new providers.JsonRpcProvider(
            `http://localhost:${port}`
        );
        const templatesManager = isKpiTokenTemplate
            ? new Contract(
                  chainAddresses.kpiTokensManager,
                  KPI_TOKENS_MANAGER_ABI,
                  await provider.getSigner(kpiTokensManagerOwner)
              )
            : new Contract(
                  chainAddresses.oraclesManager,
                  KPI_TOKENS_MANAGER_ABI,
                  await provider.getSigner(oraclesManagerOwner)
              );

        predictedTemplateId = Number(await templatesManager.nextTemplateId());
        const { setupFork } = await import(SETUP_FORK_SCRIPT_LOCATION);
        const setupResult = await setupFork({
            forkedChain,
            factory,
            kpiTokensManager,
            oraclesManager,
            predictedTemplateId,
            nodeClient: localNodeClient,
            walletClient: deployerWalletClient,
        });
        templateAddress = setupResult.templateAddress;
        customContracts = setupResult.customContracts;
        frontendGlobals = setupResult.frontendGlobals;

        await templatesManager.addTemplate(templateAddress, specificationCid);

        templateDeploymentSpinner.succeed(
            "Custom template deployed and set up on target network"
        );

        return {
            predictedTemplateId,
            frontendGlobals,
            customContracts,
            templateAddress,
        };
    } catch (error) {
        templateDeploymentSpinner.fail(
            "Could not deploy and set up custom template on target network"
        );
        console.log();
        console.log(error);
        process.exit(1);
    }
};
