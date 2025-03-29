/**
 * Provides a library for syncing Items and file attachments
 * between Diskuto instances.
 * 
 * The main class you'll use is {@link Sync}
 * 
 * @module
 */

import { Client, Signature, UserID, type ProfileResult } from "@diskuto/client"
import { lazy } from "@nfnitloop/better-iterators"
import type { Logger, ServerInfo, UserInfo } from "./logging.ts";
import type { SyncMode } from "./config.ts";


/**
 * Used to sync items between Diskuto instances.
 */
export class Sync {

    #logger: Logger;

    constructor(private config: SyncConfig) {
        if (config.servers.length < 2) {
            throw new Error(`Require 2 servers configured, found ${config.servers.length}`)
        }
        const dests = config.servers.filter(s => s.isDest).length
        if (dests == 0) {
            throw new Error(`Require at least 1 destination server, found ${dests}`)
        }

        this.#logger = config.logger
    }

    /**
     * The top-level entry into sync.
     * 
     * This can efficiently parallelize syncing multiple users and feeds. Prefer calling it vs. other methods.
     */
    async sync(opts: SyncOpts): Promise<void> {
        const usersToSync = new Map<string, SyncUserOptions>()
        const addUser = (info: SyncUserOptions) => {
            const uid = info.user.id.asBase58
            const old = usersToSync.get(uid)
            if (!old) {
                usersToSync.set(uid, info)
                return
            }
            old.user.displayName ||= info.user.displayName
            old.user.knownName ||= info.user.knownName
        }

        // TODO: parallelize. (Usually very few top-level users, though.)
        for (const user of opts.users) {
            const result = await this.#syncLatestProfile(user.id)
            if (!result) {
                throw new Error(`Couldn't load user ${UserID.name} ${user.id}`)
            }

            addUser({
                user: {
                    id: user.id,
                    displayName: result.item.itemType.value.displayName,
                },
                sync: user.sync
            })

            // Sync followed users too:
            if (user.sync.follows) {
                const profile = result.item.itemType.value
                for (const follow of profile.follows) {
                    addUser({
                        user: {
                            id: UserID.fromBytes(follow.user!.bytes),
                            knownName: follow.displayName,
                        },
                        // TODO: separate count for feeds?
                        sync: user.sync
                    })
                }
            }
        } // Done collecting users.

        await this.#syncUsers(usersToSync.values())
    }

    async #syncUsers(users: Iterable<SyncUserOptions>): Promise<void> {
        // Configurable:
        const parallelism = 5

        const tasks = lazy(users).toAsync()
            .map({
                parallel: parallelism,
                ordered: false,
                mapper: async (opts) => {
                    await this.syncUser(opts)
                }
            })
        for await (const _output of tasks) {
            // Do nothing
        }
    }

    /**
     * Sync a user's `Item`s between servers.
     */
    async syncUser(opts: SyncUserOptions): Promise<void> {
        const {user} = opts
        const logEntry = this.#logger.start({
            type: "syncUserItems",
            user: {
                id: user.id,
                displayName: user.displayName,
                knownName: user.knownName,
            }
        })
        try {
            await this.#syncUser(opts)
        } catch (err) {
            logEntry.end({type: "error", message: `${err}`})
            return
        }

        logEntry.end({type: "success"})
    }

    async #syncUser(opts: SyncUserOptions): Promise<void> {
        const {user} = opts
        let alreadySyncd = 0
        const moreToSync = () => {
            if (opts.sync.mode == "full") {
                return true
            }
            return alreadySyncd < opts.sync.count
        }

        const peekers = this.config.servers.map(s => {
            const client = new Client({baseUrl: s.url})
            return {
                server: s,
                client,
                peeker: lazy(client.getUserItems(user.id)).peekable()
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
                user,
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
    }

    async #copyItem({sources, destinations, user, signature}: CopyItemsArgs): Promise<void> {
        // Only sync to destinations that have been marked as such.
        destinations = destinations.filter(d => d.isDest)
        if (destinations.length == 0) {
            return
        }

        const source = choose(sources)
        const sourceClient = new Client({baseUrl: source.url})
        const item = await sourceClient.getItemBytes(user.id, signature)


        for (const dest of destinations) {
            const entry = this.#logger.start({
                type: "copyItem",
                dest,
                signature,
                src: source,
                user,
            })
            if (item == null) {
                entry.end({type: "error", message: "Could not copy item from source"})
                return
            }
            const destClient = new Client({baseUrl: dest.url})
            await destClient.putItem(user.id, signature, item)
            entry.end({type: "success"})
        }

        // TODO: Copy files.
    }

    /**
     * For all the servers we know, fetch the latest profile for this user. 
     * Also, sync it to any servers that don't have the latest.
     */
    async #syncLatestProfile(uid: UserID): Promise<null|ProfileResult> {
        const profiles = await lazy(this.config.servers).toAsync()
            .map(async s => {
                const client = new Client({baseUrl: s.url})
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
            user: {
                id: uid,
                displayName: profile.item.itemType.value.displayName
            },
            signature: profile.signature
        })

        return profile
    }
}

/**
 * Options for {@link Sync#syncUserFeed}
 */
export type SyncUserOptions = {
    user: {
        id: UserID,

        /** The user's own displayName */
        displayName?: string

        /** How this user is known by some other user. (Usually the feed that caused this user's content to be sync'd.) */
        knownName?: string
    }
    sync: SyncMode
}

/**
 * Options for {@link Sync.sync}
 */
export type SyncOpts = {
    users: SyncUserOpts[]
}

export type SyncUserOpts = {
    /** The name of the user in the config file. */
    name: string
    id: UserID
    sync: SyncMode
}

function choose<T>(items: T[]): T {
    // TODO: choose a random value from the list.
    return items[0]
}

type CopyItemsArgs = {
    user: UserInfo,
    signature: Signature,
    sources: ServerInfo[],
    destinations: ServerInfo[],
}

/**
 * Used by {@link Sync}'s constructor.
 */
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

    // /**
    //  * Check destination server(s) to see if they are missing file attachments.
    //  *
    //  * This is more costly and generally unnecessary.
    //  * 
    //  * Default: `false`
    //  */
    // backfillFiles?: boolean

    /** Configure how to log progress. */
    logger: Logger
}

