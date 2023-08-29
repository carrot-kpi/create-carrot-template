import ora from "ora";
import { join, resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { homedir } from "os";
import { $ } from "execa";
import { createIPFSDaemon } from "../../ipfs-daemon/createIPFSDaemon.js";
import { create as createIPFSClient } from "ipfs-http-client";

const specificationLocation = resolve("./packages/frontend/src/base.json");

const GATEWAY_PORT = 9090;
const HTTP_API_PORT = 5002;
const RPC_API_PORT = 5003;
const REPO_PATH = join(homedir(), ".cct/ipfs");

export interface StartIPFSNodeReturnValue {
    specificationCid: string;
    gatewayPort: number;
    httpAPIPort: number;
    rpcAPIPort: number;
}

export const startIPFSNode = async (): Promise<StartIPFSNodeReturnValue> => {
    const ipfsNodeSpinner = ora();
    ipfsNodeSpinner.start("Starting up local IPFS node");
    let specificationCid;
    try {
        const configPath = join(REPO_PATH, "./config");
        if (existsSync(REPO_PATH))
            rmSync(REPO_PATH, {
                force: true,
                recursive: true,
            });

        mkdirSync(REPO_PATH, {
            recursive: true,
        });
        await $({ env: { IPFS_PATH: REPO_PATH } })`ipfs init`;
        const jsonConfig = readFileSync(configPath, "utf8");
        const config = JSON.parse(jsonConfig);
        config.Addresses.API = `/ip4/127.0.0.1/tcp/${HTTP_API_PORT}`;
        config.Addresses.Gateway = `/ip4/127.0.0.1/tcp/${GATEWAY_PORT}`;
        config.API.HTTPHeaders = { "Access-Control-Allow-Origin": ["*"] };
        config.Peering = {
            Peers: [
                {
                    ID: "12D3KooWPy8d5w4sMx2Jt6xZzGr5RN8oAHoGovUNUNKax4c2HhBt",
                    Addrs: [
                        "/ip4/159.203.159.42/tcp/4001",
                        "/ip4/159.203.159.42/udp/4001/quic",
                    ],
                },
                {
                    ID: "12D3KooWMvyh55eTC7TGJUxboLsm3dnEhdZbfjs7K2Td3ivBt9ze",
                    Addrs: [
                        "/ip4/206.189.252.234/tcp/4001",
                        "/ip4/206.189.252.234/udp/4001/quic",
                    ],
                },
            ],
        };
        writeFileSync(configPath, JSON.stringify(config, null, 4));

        const ipfsDaemon = createIPFSDaemon({ repoPath: REPO_PATH });
        await ipfsDaemon.start();

        const ipfsClient = createIPFSClient({
            url: `http://127.0.0.1:${HTTP_API_PORT}`,
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

        return {
            specificationCid,
            gatewayPort: GATEWAY_PORT,
            httpAPIPort: HTTP_API_PORT,
            rpcAPIPort: RPC_API_PORT,
        };
    } catch (error) {
        ipfsNodeSpinner.fail("Could not start up local IPFS node");
        console.log();
        console.log(error);
        process.exit(1);
    }
};
