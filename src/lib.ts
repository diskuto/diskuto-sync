/**
 * Provides a library for syncing Items and file attachments
 * between Diskuto instances.
 * 
 * The main class you'll use is {@link Sync}
 * 
 * @module
 */

import { Client, Signature, type UserID } from "@nfnitloop/feoblog-client"
import { lazy } from "@nfnitloop/better-iterators"


/**
 * Used to sync items between Diskuto instances.
 */
export class Sync {
    #logger: Logger;

    constructor(private config: SyncConfig) {
        if (config.servers.length < 2) {
            throw new Error(`Require 2 servers configured, found ${config.servers.length}`)
        }
        const dests = config.servers.filter(s => s.dest).length
        if (dests == 0) {
            throw new Error(`Require at least 1 destination server, found ${dests}`)
        }

        this.#logger = config.logger
    }

    async syncUser(uid: UserID) {
        const opName = "synchronizing user " + uid
        this.#logger.operation("starting", opName)

        const peekers = this.config.servers.map(s => {
            const client = new Client({base_url: s.url})
            return {
                server: s,
                client,
                peeker: lazy(client.getUserItems(uid)).peekable()
            }
        })
        while (true) {
            // TODO: Check a time/count limit for the sync instead of always syncing everything.

            const tips = await lazy(peekers)
                .toAsync()
                .map(async p => {
                    const nextValue = await p.peeker.peek()
                    return {server: p.server, nextValue, peeker: p.peeker}
                })
                .toArray()

            // All servers should be giving us their newest items first.
            // Find all servers that have that "newest" item. Any that don't are missing it, by
            // showing us something older at their tip.
            const timestamps = tips
                .map(t => t.nextValue)
                .filter(t => !t.done)
                .map(t => Number(t.value.timestampMsUtc))
            if (timestamps.length == 0) {
                // All servers have finished giving us items.
                break
            }

            const tip = Math.min(...timestamps)
            const {matches, others} = lazy(tips)
                .partition(t => !t.nextValue.done && Number(t.nextValue.value.timestampMsUtc) == tip)

            const nextValue = matches[0].nextValue
            if (nextValue.done) {
                // should never throw, we matched on having a value.
                throw new Error(`coding logic error: can not find next Item`)
            }
            const signature = Signature.fromBytes(nextValue.value.signature!.bytes)

            // Matching servers all alrady have the content. Copy it to the other servers, 
            // IFF they're marked as a destination.
            await this.#copyItems({
                userId: uid,
                signature,
                sources: matches.map(s => s.server),
                destinations: others.map(s => s.server)
            })

            // Pop the copied item off of the stack.
            for (const match of matches) {
                await match.peeker.next()
            }
        }

        this.#logger.operation("done", opName)
    }

    async #copyItems({sources, destinations, userId, signature}: CopyItemsArgs): Promise<void> {
        // Only sync to destinations that have been marked as such.
        destinations = destinations.filter(d => d.dest)
        if (destinations.length == 0) {
            return
        }

        // TODO: choose random source.
        const source = choose(sources)
        const sourceClient = new Client({base_url: source.url})
        const item = await sourceClient.getItemBytes(userId, signature)


        for (const dest of destinations) {
            const logInfo: LogCopyItem = {
                dest,
                source,
                event: "starting",
                userId,
                signature
            }
            this.#logger.copyItem(logInfo)
            if (item == null) {
                this.#logger.copyItem({...logInfo, event: "done", error: "Could not read item from source"})
                continue
            }
            const destClient = new Client({base_url: dest.url})
            await destClient.putItem(userId, signature, item)
            this.#logger.copyItem({...logInfo, event: "done"})
        }
    }


}

function choose<T>(items: T[]): T {
    // TODO: choose a random value from the list.
    return items[0]
}

type CopyItemsArgs = {
    sources: ServerInfo[],
    destinations: ServerInfo[],
    userId: UserID,
    signature: Signature,
}

export type SyncConfig = {
    /** 
     * What servers to sync between.
     * 
     * Must have at least 2, and at least one must be marked as a destination.
     */
    servers: ServerInfo[],

    /**
     * Should we copy `Item` file attachments when we copy an item?
     * 
     * Defaults to `true`. Note this ONLY triggers if the `Item` was also missing
     * from the/a destination server. See {@link backfillFiles} if you're missing
     * some older attachments.
     * 
     * Default: `true`
     */
    copyFiles?: boolean

    /**
     * Check destination server(s) to see if they are missing file attachments.
     *
     * This is more costly and generally unnecessary.
     * 
     * Default: `false`
     */
    backfillFiles?: boolean

    /** Configure how to log progress. */
    logger: Logger
}

export type ServerInfo = {


    /** The URL to access this server's API. */
    url: string,

    /** A short name to refer to this server by when logging. */
    name?: string,

    /** Set to `true` to mark this server as a destination that should be updated by the sync. */
    dest?: boolean
}

/**
 * The interface for a logger that you can provide to `Sync` to see the progress of operations.
 */
export type Logger = {
    /** Called when copying an item. */
    copyItem(args: LogCopyItem): void

    /** Called when copying an item's file attachment(s) */
    copyFile(args: LogCopyFile): void

    /**  Called when starting/finishing a bulk operation. ex: "Syncing user posts" */
    operation(event: LogType, name: string): void
}

export type LogType = "starting" | "done"

export type LogCopyItem = {
    event: LogType,
    source: ServerInfo
    dest: ServerInfo
    userId: UserID
    signature: Signature
    error?: string
}

export type LogCopyFile = LogCopyItem & {
    fileName: string
    // TODO: fileSize?
}


export class NoOpLogger implements Logger {
    copyItem(_args: LogCopyItem): void { /* Do nothing */ }
    copyFile(_args: LogCopyFile): void { /* Do nothing */ }

    operation(_event: LogType, _name: string) { /* Do nothing */ }
}

export class ConsoleLogger implements Logger {
    copyItem(args: LogCopyItem): void {
        const {event, source, dest, userId, signature, error} = args
        if (error) {
            console.error(event, "copying item from", source.name, "to", dest.name, userId.asBase58, signature.asBase58, error)
        } else {
            console.info(event, "copying item from", source.name, "to", dest.name, userId.asBase58, signature.asBase58)
        }
    }
    copyFile(args: LogCopyFile): void {
        const {event, source, dest, userId, signature, error, fileName} = args

        if (error) {
            console.error(event, "copying file from", source.name, "to", dest.name, userId.asBase58, signature.asBase58, fileName, error)
        } else {
            console.info(event, "copying item from", source.name, "to", dest.name, userId.asBase58, signature.asBase58, fileName)
        }
    }

    operation(event: LogType, name: string) { 
        console.log(event, name)
    }
}