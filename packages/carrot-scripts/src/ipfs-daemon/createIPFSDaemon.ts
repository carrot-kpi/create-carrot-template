import { stripColors } from "./stripColors.js";
import type { ExecaChildProcess } from "execa";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { execa } from "execa";

// Code mostly taken from anvil.js from the wagmi team

export type IPFSDaemon = {
    start(): Promise<void>;
    stop(): Promise<void>;
    on(event: "message", listener: (message: string) => void): () => void;
    on(event: "stderr", listener: (message: string) => void): () => void;
    on(event: "stdout", listener: (message: string) => void): () => void;
    on(event: "closed", listener: () => void): () => void;
    on(
        event: "exit",
        listener: (code?: number, signal?: NodeJS.Signals) => void
    ): () => void;
    readonly status: "idle" | "starting" | "stopping" | "listening";
    readonly logs: string[];
    readonly options: CreateIPFSDaemonOptions;
};

export interface IPFSDaemonOption {
    repoPath: string;
}

export type CreateIPFSDaemonOptions = IPFSDaemonOption & {
    binary?: string;
    startTimeout?: number | undefined;
    stopTimeout?: number | undefined;
};

export function createIPFSDaemon(options: CreateIPFSDaemonOptions): IPFSDaemon {
    const emitter = new EventEmitter();
    const logs: string[] = [];

    emitter.on("message", (message: string) => {
        logs.push(message);

        if (logs.length > 20) {
            logs.shift();
        }
    });

    let ipfsDaemon: ExecaChildProcess | undefined;
    let controller: AbortController | undefined;
    let status: "idle" | "starting" | "stopping" | "listening" = "idle";

    const {
        binary = "ipfs",
        startTimeout = 10_000,
        stopTimeout = 10_000,
        repoPath,
    } = options;

    const stdout = new Writable({
        write(chunk, _, callback) {
            try {
                const message = stripColors(chunk.toString());
                emitter.emit("message", message);
                emitter.emit("stdout", message);
                callback();
            } catch (error) {
                callback(
                    error instanceof Error
                        ? error
                        : new Error(
                              typeof error === "string" ? error : undefined
                          )
                );
            }
        },
    });

    const stderr = new Writable({
        write(chunk, _, callback) {
            try {
                const message = stripColors(chunk.toString());
                emitter.emit("message", message);
                emitter.emit("stderr", message);
                callback();
            } catch (error) {
                callback(
                    error instanceof Error
                        ? error
                        : new Error(
                              typeof error === "string" ? error : undefined
                          )
                );
            }
        },
    });

    async function start() {
        if (status !== "idle") {
            throw new Error("IPFS instance not idle");
        }

        status = "starting";

        return new Promise<void>(async (resolve, reject) => {
            let log: string | undefined = undefined;

            async function setFailed(reason: Error) {
                status = "stopping";

                clearTimeout(timeout);
                emitter.off("message", onMessage);
                emitter.off("exit", onExit);

                try {
                    if (
                        controller !== undefined &&
                        !controller?.signal.aborted
                    ) {
                        controller.abort();
                    }

                    await ipfsDaemon;
                } catch {}

                status = "idle";
                reject(reason);
            }

            function setStarted() {
                status = "listening";

                clearTimeout(timeout);
                emitter.off("message", onMessage);
                emitter.off("exit", onExit);

                resolve();
            }

            function onExit() {
                if (status === "starting") {
                    if (log !== undefined) {
                        setFailed(new Error(`IPFS daemon exited: ${log}`));
                    } else {
                        setFailed(new Error("IPFS daemon exited"));
                    }
                }
            }

            function onMessage(message: string) {
                log = message;

                if (status === "starting") {
                    // We know that IPFS daemon is listening when it prints this message.
                    if (message.includes("Daemon is ready")) {
                        setStarted();
                    }
                }
            }

            emitter.on("exit", onExit);
            emitter.on("message", onMessage);

            const timeout = setTimeout(() => {
                setFailed(new Error("IPFS daemon failed to start in time"));
            }, startTimeout);

            controller = new AbortController();

            ipfsDaemon = execa(binary, ["daemon"], {
                signal: controller.signal,
                cleanup: true,
                env: {
                    IPFS_PATH: repoPath,
                },
            });

            ipfsDaemon.on("closed", () => emitter.emit("closed"));
            ipfsDaemon.on("exit", (code, signal) => {
                emitter.emit("exit", code ?? undefined, signal ?? undefined);
            });

            ipfsDaemon.pipeStdout!(stdout);
            ipfsDaemon.pipeStderr!(stderr);
        });
    }

    async function stop() {
        if (status === "idle") {
            return;
        }

        const timeout = new Promise<void>((_, reject) => {
            setTimeout(() => {
                reject(new Error("IPFS daemon failed to stop in time"));
            }, stopTimeout);
        });

        const closed = new Promise<void>((resolve) => {
            ipfsDaemon?.once("close", () => resolve());
        });

        try {
            if (controller !== undefined && !controller?.signal.aborted) {
                controller.abort();
            }

            await ipfsDaemon;
        } catch {}

        status = "idle";
        ipfsDaemon = undefined;
        controller = undefined;

        return Promise.race([closed, timeout]);
    }

    return {
        start,
        stop,
        on: (event: string, listener: any) => {
            emitter.on(event, listener);

            return () => {
                emitter.off(event, listener);
            };
        },
        get status() {
            return status;
        },
        get logs() {
            return logs.slice();
        },
        get options() {
            // NOTE: This is effectively a safe, readonly copy because the options are a flat object.
            return { ...options };
        },
    };
}
