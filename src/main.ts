#!/usr/bin/env -S deno run --allow-net --allow-read --deny-env

import { Command, HelpCommand } from "@cliffy/command"
import { loadConfig } from "./config.ts";
import { Sync } from "./lib.ts";
import { UserID } from "@diskuto/client";
import { FancyLogger } from "./fancyLogger.ts";
import type { ServerInfo } from "./logging.ts";

/**
 * 
 * Provides a CLI for running sync commands.
 * But you can alternatively import the `./lib` module to use
 * this as a library for yourself.
 * 
 * See [diskuto-sync.sample.toml] for an example configuration.
 * 
 * [Diskuto]: https://github.com/diskuto
 * [diskuto-sync.sample.toml]: ./diskuto-sync.sample.toml
 * 
 */
export async function main(args: string[]): Promise<void> {
    const cmd = new Command()
        .name("diskuto-sync")
        .description("A tool to sync Diskuto instances' data.")
        .default("help")
    
    cmd.command("help", new HelpCommand().global())

    const sync = new Command()
        .name("sync")
        .description("Run a sync according to the config file.")
        .option("--config <configPath:string>", "Location of config file to load.", {
            default: "diskuto-sync.toml"
        })
        .action(cmdSync)    
    cmd.command(sync.getName(), sync)

    await cmd.parse(args)
}

type SyncArgs = {
    config: string
}

async function cmdSync({config: configPath}: SyncArgs) {
    const config = await loadConfig(configPath)
    const logger = new FancyLogger()
    // const logger = new ConsoleLogger()
    const sync = new Sync({
        logger,
        servers: Object.entries(config.servers).map(([name, info]) => {
            return {
                url: info.url,
                name,
                isDest: info.dest
            } satisfies ServerInfo
        }),
    })

    await sync.sync({
        users: Object.entries(config.users).map(([name, info]) => {
            return {
                ...info,
                name,
            }
        })
    })
}


if (import.meta.main) {
    await main(Deno.args)
}
