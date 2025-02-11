#!/usr/bin/env -S deno run --allow-net --allow-read --deny-env

/**
 * This is a sync tool for [Diskuto] social network instances.
 * 
 * It can "diff" two (or more) instances and copy missing
 * items from one to another.
 * 
 * This top-level module provides a CLI for running sync commands.
 * But you can alternatively import the `./lib` module to use
 * as a library for yourself.
 * 
 * TODO: Diskuto is the new name for the *protocol* part of [FeoBlog].
 * You may see mentions of FeoBlog until [the rename] is complete.
 * 
 * [Diskuto]: https://example.com/TODO
 * [FeoBlog]: https://github.com/nfnitloop/feoblog/
 * [the rename]: https://github.com/NfNitLoop/feoblog/issues/127
 * 
 * @module
 */

import { Command, HelpCommand } from "@cliffy/command"
import { loadConfig } from "./config.ts";
import { ConsoleLogger, Sync, type LogCopyItem } from "./lib.ts";
import { UserID } from "@nfnitloop/feoblog-client";
import { Spinner } from "@std/cli/unstable-spinner"

export async function main(args: string[]) {
    const cmd = new Command()
        .name("diskuto-sync")
        .description("A tool to sync Diskuto instances' data.")
        .default("help")
    
    cmd.command("help", new HelpCommand().global())

    const serve = new Command()
        .name("sync")
        .description("Run a sync according to the config file.")
        .option("--config <configPath:string>", "Location of config file to load.", {
            default: "diskuto-sync.toml"
        })
        .action(cmdSync)    
    cmd.command(serve.getName(), serve)

    await cmd.parse(args)
}

type SyncArgs = {
    config: string
}

async function cmdSync({config: configPath}: SyncArgs) {
    const config = await loadConfig(configPath)
    const logger = new PrettyLogger()
    const sync = new Sync({
        logger,
        servers: Object.entries(config.servers).map(([name, info]) => ({...info, name})),
    })

    // Sync users first:
    for (const [_name, user] of Object.entries(config.users)) {
        const uid = UserID.fromString(user.id)
        await sync.syncUser(uid, user)
    }

    // Sync user feeds last:
    for (const [_name, user] of Object.entries(config.users)) {
        if (!user.feed?.sync) { continue }
        const uid = UserID.fromString(user.id)
        await sync.syncUserFeed(uid, user.feed)
    }
}

class PrettyLogger extends ConsoleLogger {

    #spinner: Spinner|null = null

    override copyItem(args: LogCopyItem): void {
        const {event, dest, error, source, signature, userId} = args
        const sourceName = source.name ?? source.url
        const destName = dest.name ?? dest.url
        const base = `${sourceName} → ${destName} ${userId} ${signature}`

        if (event == "starting" && this.#spinner) {
            console.error("Error: Spinner was left running when starting a new one.")
            this.#spinner.stop()
            this.#spinner = null
        }

        if (event == "starting") {
            this.#spinner = new Spinner({message: base, color: "yellow"})
            this.#spinner.start()
            return
        }

        this.#spinner?.stop()
        this.#spinner = null

        const status = error ? "❌" : "✅"
        console.log(`${status} ${base}`)
        if (error) {
            console.log("Error:", error)
        }

    }
}

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
    await main(Deno.args)
}
