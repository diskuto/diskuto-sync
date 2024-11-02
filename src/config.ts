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

    if (config.servers.length < 2) {
        throw new Error(`Must have at least 2 servers listed, found ${config.servers.length}`)
    }

    const dests = config.servers.filter(s => s.dest).length
    if (dests == 0) {
        throw new Error(`Must have at least one destination server configured. (dest=true)`)
    }

    return config
}

export type Server = z.infer<typeof Server>
const Server = z.object({
    name: z.string().min(1),
    url: z.string().url().startsWith("http") /* or https */,
    dest: z.boolean().optional().default(false)
}).strict()

export type User = z.infer<typeof User>
const User = z.object({
    id: z.string().min(1).describe("base58-encoded userID to sync"),
    name: z.string().min(1).optional()
}).strict()



export type Config = z.infer<typeof Config>
const Config = z.object({
    servers: z.array(Server).min(2),
    users: z.array(User).min(1),
    backfillFiles: z.boolean().optional().default(false),
    copyFiles: z.boolean().optional().default(true),
}).strict()