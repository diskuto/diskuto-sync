/**
 * Use Dax's nice logging.
 */

import $, { type ProgressBar } from "@david/dax"
import type { LogEnd, LogEntry, LogEvent, Logger } from "./logging.ts";
import { fmtEvent } from "./loggers.ts";

export class FancyLogger implements Logger {
    start(event: LogEvent): LogEntry {
        if (event.type == "debug") {
            $.logLight(...event.messageParts)
            return { end: () => {}, bytesCopied: () => {} }
        }

        const msg = fmtEvent(event)

        const length = (
            event.type == "copyFile"
            ? event.totalBytes
            : undefined
        )
        const prog = $.progress(msg, {length}).kind("bytes")

        return {
            end: end => logEnd(end, event, prog),
            bytesCopied: bytes => {
                prog.increment(bytes)
            }
        }  
    }
}

function logEnd(endEvent: LogEnd, logEvent: LogEvent, prog: ProgressBar): void {
    if (endEvent.type == "success") {
        prog.finish()
        return
    }

    const detail = JSON.stringify(logEvent)

    if (endEvent.type == "warning") {
        $.logWarn("WARNING:", endEvent.message, "detail:", detail)
        prog.finish()
        return
    }
    if (endEvent.type == "error") {
        $.logError("ERROR:", endEvent.message, "detail:", detail)
        prog.finish()
        return
    }

    assertNever(endEvent)
}

function assertNever(_term: never): never {
    throw new Error("Unreachable code: Logic error")
}
