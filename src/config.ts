/** 
 * Tools for reading/parsing the configuration file.
 * 
 * @module
 */

import { type } from "arktype"
import * as toml from "@std/toml"
import * as client from "@diskuto/client";

export async function loadConfig(path: string): Promise<Config> {
    const text = await Deno.readTextFile(path)
    const obj = toml.parse(text)
    const config = Config.assert(obj)


    if (Object.entries(config.servers).length < 2) {
        throw new Error(`Must have at least 2 servers listed, found ${config.servers.length}`)
    }

    const dests = Object.entries(config.servers).filter(([_k,v]) => v.dest).length
    if (dests == 0) {
        throw new Error(`Must have at least one destination server configured. (dest=true)`)
    }

    return config
}

const SyncBase = type({
    follows: "boolean = false"
})

const SyncLatest = type({
    mode: `"latest"`,
    count: "number.integer > 0 = 50"
}).and(SyncBase)

const SyncFull = type({
    mode: `"full"`,
    backfillAttachments: "boolean = false",
}).and(SyncBase)


export type SyncMode = typeof SyncMode.infer
const SyncMode = SyncLatest
    .or(SyncFull)

// .try(UserID.fromString).describe("a valid Diskuto UserID")
const UserId = type("string")
    .describe("a valid UserID")
    .pipe.try(value => client.UserID.fromString(value))
    .as<NamedType<client.UserID>>()

export type User = typeof User.infer
const User = type({
    id: UserId,
    sync: SyncMode.default(() => ({mode: "latest", count: 50})),
})

export type Server = typeof Server.infer
const Server = type({
    url: type("string.url").to(/^https?/),
    "dest?": "boolean"
})


export type Config = typeof Config.infer
const Config = type({
    servers: type.Record("string", Server),
    users: type.Record("string", User),
}).onDeepUndeclaredKey("reject")

/** Work around arktype's type expander. It stops at constructors. */
type NamedType<T> = T & {
    new(): T
}