/** 
 * Tools for reading/parsing the configuration file.
 * 
 * @module
 */

import * as z from "zod"
import * as toml from "@std/toml"

export async function loadConfig(path: string): Promise<Config> {
    const text = await Deno.readTextFile(path)
    const obj = toml.parse(text)
    const config = Config.parse(obj)


    if (Object.entries(config.servers).length < 2) {
        throw new Error(`Must have at least 2 servers listed, found ${config.servers.length}`)
    }

    const dests = Object.entries(config.servers).filter(([_k,v]) => v.dest).length
    if (dests == 0) {
        throw new Error(`Must have at least one destination server configured. (dest=true)`)
    }

    return config
}

export type Server = z.infer<typeof Server>
const Server = z.object({
    url: z.string().url().startsWith("http") /* or https */,
    dest: z.boolean().optional().default(false)
}).strict()

export type UserFeed = z.infer<typeof UserFeed>
const UserFeed = z.object({
    sync:  z.boolean().optional().default(false),

    /** Default in app: 50 */
    maxCount: z.number().int().optional(),
    // TODO: maxAgeSeconds: z.number().optional(),
}).strict()

export type User = z.infer<typeof User>
const User = z.object({
    id: z.string().min(1).describe("base58-encoded userID to sync"),
    maxCount: z.number().int().optional(),
    feed: UserFeed.optional(),
}).strict()


export type Config = z.infer<typeof Config>
const Config = z.object({
    servers: z.record(Server),
    users: z.record(User),
    backfillFiles: z.boolean().optional().default(false),
    copyFiles: z.boolean().optional().default(true),
}).strict()