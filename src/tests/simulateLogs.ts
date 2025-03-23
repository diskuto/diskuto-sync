#!/usr/bin/env -S deno run -E

// Simulates logging some event so I can see how they look in the terminal without actually
// having to sync some data.

import { PrivateKey, Signature } from "@diskuto/client";
import { ConsoleLogger } from "../loggers.ts";
import type { Logger, ServerInfo, UserInfo } from "../logging.ts";

import { delay } from "jsr:@std/async"
import { lazy, range } from "@nfnitloop/better-iterators";
import { randomBytes } from "jsr:@noble/hashes@^1.7.0/utils";
import { FancyLogger } from "../fancyLogger.ts";


// TODO: Should probably have made this whole file a class.
const opts = {
    percentChance: {
        errorOrWarn: 2,
        warn: 50,
        itemHasFile: 20,
    },
    files: {
        minSizeBytes: 3000,
        maxSizeBytes: 1024 * 1024 * 50, // 50 MiB
        copyTimeMs: {
            min: 300,
            max: 5000,
        }
    }
} as const

async function main(args: string[]) {
    const logger = (
        args.includes("old")
        ? new ConsoleLogger()
        : new FancyLogger()
    )
    await simulateLogs({
        // logger: new ConsoleLogger(),
        logger,
        parallel: 5,
        src: { url: "https://blog.nfnitloop.com" },
        dest: { url: "http://localhost:8099" },
    })
}

type Args = {
    logger: Logger
    parallel: number
    src: ServerInfo,
    dest: ServerInfo,
}

async function simulateLogs({logger, parallel, src, dest}: Args) {
    const mainUser: UserInfo = {
        id: PrivateKey.createNew().userID,
        displayName: "Cody"
    }

    const syncFeed = logger.start({
        type: "syncFeed",
        user: mainUser,
    })

    // Sync Profile:
    const syncProfile = logger.start({
        type: "syncProfile",
        user: mainUser,
    })
    await delay(150)
    await simCopyItem({
        logger,
        user: mainUser,
        src, 
        dest,
    })
    syncProfile.end({type: "success"})


    // Sync feed (& own profile)
    const users = [
        mainUser,
        ... fakeUsers()
    ]

    await lazy(users)
        .map({
            parallel,
            ordered: false,
            mapper: async (user) => { 
                await simSyncUser({logger, user, src, dest})
            }
        })
        .toArray()

    syncFeed.end({type: "success"})
}

type CommonArgs = {logger: Logger, user: UserInfo, src: ServerInfo, dest: ServerInfo}

async function simSyncUser(args: CommonArgs) {
    const {logger, user} = args
    const numItems = 5 + Math.floor(Math.random() * 15)

    const syncUser = logger.start({
        type: "syncUserItems",
        user
    })

    for (const _count of range({to: numItems})) {
        await simCopyItem(args)
    }

    syncUser.end({type: "success"})
}

async function simCopyItem(args: CommonArgs)
{
    const signature = Signature.fromBytes(randomBytes(64))

    const {logger, user, src, dest} = args

    const copyItem = logger.start({
        type: "copyItem", 
        user,
        signature,
        src,
        dest,
    })

    const delayMs = 50 + Math.random() * 200
    await delay(delayMs)

    // Random warn/error.
    if (chancePercent(opts.percentChance.errorOrWarn)) {
        if (chancePercent(opts.percentChance.warn)) {
            copyItem.end({
                type: "warning",
                message: "Something went wrong",
            })
        } else {
            copyItem.end({
                type: "error",
                message: "Something went VERY wrong."
            })
        }
    } else {
        await simCopyFiles({...args, signature})
        copyItem.end({type: "success"})
    }
}

function chancePercent(percent: number): boolean {
    return Math.random() < (percent / 100)
}

function choose<const T>(...choices: T[]): T {
    const index = randomInt(0, choices.length - 1)
    return choices[index]
}

type Int = number

/** Inclusive random number in range. Assumes integers. */
function randomInt(min: Int, max: Int): Int {
    const delta = max - min + 1
    return Math.floor(Math.random() * delta) + min
}

// TODO: Repurpose to simulate copying a file:
// async function simTask(name: string) {
//     const length = 10
//     const pb = $.progress(name, {length})
//     const totalTime = 300 + Math.random() * 3000
//     const waitTime = totalTime / length
//     await pb.with(async() => {
//         for (const _ of range({to: length})) {
//             await $.sleep(waitTime)
//             pb.increment()
//         }
//     })
//     // $.log("✅", name)
// }

function fakeUsers(): UserInfo[] {
    return [
        "Bob",
        "Jack",
        "New York Times",
        "Kotaku",
        "Mother Jones",
        "Mastodon Feed",
        "Twitter Feed",
        "NPR News",
        undefined,
        "CNN",
        "That One Guy",
        "The Corner Coffee Shop",
    ].map(it => ({
        id: PrivateKey.createNew().userID,
        knownName: it
    }))
}

async function simCopyFiles(args: { signature: Signature} & CommonArgs) {
    if (!chancePercent(opts.percentChance.itemHasFile)) {
        return;
    }

    const {user, signature, src, dest, logger} = args

    const fileCount = choose(1, 1, 1, 2, 2, 3)

    for (let fileNum = 1; fileNum <= fileCount; fileNum++) {
        const ext = choose("jpeg", "png", "gif", "zip")
        const fileName = `example.${fileNum}.${ext}`
        const totalBytes = randomInt(opts.files.minSizeBytes, opts.files.maxSizeBytes)
        const entry = logger.start({
            type: "copyFile",
            src,
            dest,
            user,
            signature,
            fileName,
            totalBytes
        })

        const numChunks = randomInt(3, 40)
        const chunkSize = Math.floor(totalBytes / numChunks)
        const {copyTimeMs} = opts.files
        const copyMs = randomInt(copyTimeMs.min, copyTimeMs.max)
        const chunkMs = copyMs / numChunks
        for (let i = 0; i < numChunks; ++i) {
            // $.logLight("Waiting", chunkMs, fileName)
            await delay(chunkMs)
            entry.bytesCopied(chunkSize)
        }

        entry.end({type: "success"})
    }
}


if (import.meta.main) {
    await main(Deno.args)
}