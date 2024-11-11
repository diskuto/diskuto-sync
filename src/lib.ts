/**
 * Provides a library for syncing Items and file attachments
 * between Diskuto instances.
 * 
 * The main class you'll use is {@link Sync}
 * 
 * @module
 */

import { Client, Signature, UserID, type ProfileResult } from "@nfnitloop/feoblog-client"
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

    /**
     * Sync a user's `Item`s between servers.
     * 
     * TODO: Options for limiting item count/type/date-range/etc.
     */
    async syncUser(uid: UserID, opts?: SyncUserOptions) {
        const opName = "synchronizing user " + uid
        this.#logger.operation("starting", opName)

        const maxToSync = opts?.maxCount ?? 50
        let alreadySyncd = 0

        const moreToSync = () => {
            return maxToSync <= 0 || alreadySyncd < maxToSync
        }

        const peekers = this.config.servers.map(s => {
            const client = new Client({base_url: s.url})
            return {
                server: s,
                client,
                peeker: lazy(client.getUserItems(uid)).peekable()
            }
        })
        while (moreToSync()) {

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

            const tip = Math.max(...timestamps)
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
            await this.#copyItem({
                userId: uid,
                signature,
                sources: matches.map(s => s.server),
                destinations: others.map(s => s.server)
            })

            // Pop the copied item off of the stack.
            for (const match of matches) {
                await match.peeker.next()
            }

            alreadySyncd += 1
        }

        this.#logger.operation("done", opName)
    }

    async #copyItem({sources, destinations, userId, signature}: CopyItemsArgs): Promise<void> {
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

        // TODO: Copy files.
    }

    /**
     * Sync a users's "feed": all the users they follow.
     */
    async syncUserFeed(uid: UserID, opts?: SyncUserFeedOptions) {
        const thisOp = `Syncing user feed ${uid}`
        this.#logger.operation("starting", thisOp)
        const response = await this.#syncLatestProfile(uid)
        if (!response) {
            const msg = `Couldn't find user profile: ${uid}`
            this.#logger.operation("done", thisOp, )
            throw new Error(msg)
        }

        const itemType = response.item.itemType.case
        if (itemType != "profile") {
            const msg = `Got wrong item type: ${itemType}`
            this.#logger.operation("done", thisOp, msg)
            throw new Error(msg)
        }

        const profile = response.item.itemType.value
        for (const follow of profile.follows) {
            const followId = UserID.fromBytes(follow.user!.bytes)
            await this.syncUser(followId, opts)
        }

        this.#logger.operation("done", thisOp)
    }

    /**
     * For all the servers we know, fetch the latest profile for this user. 
     * Also, sync it to any servers that don't have the latest.
     */
    async #syncLatestProfile(uid: UserID): Promise<null|ProfileResult> {
        const profiles = await lazy(this.config.servers).toAsync()
            .map(async s => {
                const client = new Client({base_url: s.url})
                const profile = await client.getProfile(uid)
                return {server: s, client, profile}
            })
            .toArray()
        

        const timestamps = profiles
            .map(p => p.profile)
            .filter(p => p != null)
            .map(p => Number(p.item.timestampMsUtc))
        if (timestamps.length == 0) {
            return null
        }

        const latest = Math.max(...timestamps)

        const {matches, others} = lazy(profiles)
            .partition(p => p.profile != null && (Number(p.profile.item.timestampMsUtc) == latest))

        const profile = matches[0].profile!

        // Technically we've already loaded the item but I'm reusing this:
        await this.#copyItem({
            sources: matches.map(m => m.server),
            destinations: others.map(m => m.server),
            userId: uid,
            signature: profile.signature
        })

        return profile
    }
}

/**
 * Options for {@link Sync#syncUserFeed}
 */
export type SyncUserFeedOptions = {
    /**
     * Maximum number of items to sync from each user.
     * 
     * If unspecified, and no other limits are specified, defaults to 50.
     * 
     * Specifying a number <= 0 means there is no limit.
     */
    maxCount?: number
}

/**
 * Options for {@link Sync#syncUser}
 */
export type SyncUserOptions = SyncUserFeedOptions

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
    operation(event: LogType, name: string, error?: string): void
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

    operation(event: LogType, name: string, error?: string) { 
        if (error) {
            console.error("error:", name, error)
        } else {
            console.log(event, name)
        }
    }
}