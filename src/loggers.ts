/**
 * Implementations of the logging interfaces.
 * 
 * @module
 */

import type { LogEnd, LogEntry, LogEvent, Logger, ServerInfo } from "./logging.ts";
import * as colors from "jsr:@std/fmt@1.0.6/colors"

/**
 * A logger that does nothing.
 * 
 * Not recommended because it can swallow errors.
 */
export class NoOpLogger implements Logger {
    start(_event: LogEvent): LogEntry {
        return noOpEvent
    }
}

/**
 * Simple, plain-text console logger.
 */
export class ConsoleLogger implements Logger {
    start(event: LogEvent): LogEntry {
        if (event.type == "debug") {
            console.debug(...event.messageParts)
            return noOpEvent
        }

        const msg = fmtEvent(event)
        console.log(msg)

        return {
            end: end => this.#logEnd(end, event), 
            bytesCopied: noOp,
        }  
    }
    #logEnd(end: LogEnd, event: LogEvent): void {
        if (end.type == "success") {
            return
        }

        const detail = JSON.stringify(event)
        if (end.type == "warning") {
            console.warn(colorFor.warning("WARNING:"), end.message, "detail:", detail)
            return
        }
        if (end.type == "error") {
            console.error(colorFor.error("ERROR:"), end.message, "detail:", detail)
            return
        }
        assertNever(end)
    }
}

const noOp = () => {}
const noOpEvent: LogEntry = {
    end: noOp,
    bytesCopied: noOp,
}

export function fmtEvent(event: LogEvent): string {
    if (event.type == "debug") {
        // Not actually reachable due to shortcut in start()
        return event.messageParts.join(" ")
    }
    const userInfo = event.user
    const user = colorFor.user(
        userInfo.knownName
        ?? userInfo.displayName
        ?? userInfo.id.asBase58
    )


    if (event.type == "syncProfile") {
        return `Syncing profile for ${user}`
    }
    if (event.type == "syncFeed") {
        return `Syncing feed for ${user}`
    }
    if (event.type == "syncUserItems") {
        return `Syncing items for ${user}`
    }

    const {src, dest} = fmtServers(event)
    const servers = colorFor.servers(`${src} → ${dest}`)

    const sig = event.signature.asBase58
    const shortSig = colorFor.shortSig(sig.substring(0, 6) + "…")

    if (event.type == "copyItem") {
        return `Copy item for ${user} ${shortSig} ${servers}`
    }

    if (event.type == "copyFile") {
        return `Copy file ${event.fileName} for ${user} ${shortSig} ${servers} `
    }       

    return assertNever(event)
}

const colorFor = {
    user: colors.yellow,
    servers: colors.gray,
    shortSig: colors.gray,
    error: (s: string) => colors.red(colors.bold(s)),
    warning: (s: string) => colors.yellow(colors.bold(s))

} as const

export function fmtServers(servers: {src: ServerInfo, dest: ServerInfo}): {src: string, dest: string} {
    const {src: s, dest: d} = servers
    if (s.name || d.name) {
        return {
            src: s.name ?? s.url,
            dest: d.name ?? d.url,
        }
    }

    // Neither has a name, maybe we can just use hostname:
    try {
        const sUrl = new URL(s.url)
        const dUrl = new URL(d.url)
        if (sUrl.hostname != dUrl.hostname) {
            return {
                src: sUrl.hostname,
                dest: dUrl.hostname
            }
        }
        if (sUrl.host != dUrl.host) {
            return {
                src: sUrl.host,
                dest: dUrl.host
            }
        }
    } catch (_err) {
        // fallthrough
    }

    return {src: s.url, dest: d.url}
}

function assertNever(_term: never): never {
    throw new Error("Unreachable code: Logic error")
}

