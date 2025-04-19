/**
 * Use Dax's nice logging.
 */

import $, { type ProgressBar } from "@david/dax"
import type { LogEnd, LogEventHandler, LogEvent, Logger } from "./logging.ts";
import { fmtEvent } from "./loggers.ts";

export class FancyLogger implements Logger {
    start(event: LogEvent): LogEventHandler {
        if (event.type == "debug") {
            $.logLight(...event.messageParts)
            return { } 
        }

        const msg = fmtEvent(event)

        const {length, kind}: { length?: number, kind: "bytes" | "raw" } = (
            event.type == "copyFile" ? { length: event.totalBytes, kind: "bytes" }
            : event.type == "syncUserItems" ? { length: event.maxCount, kind: "raw" }
            : { length: undefined, kind: "raw" }
        )
        const noClear = false // TODO: Configurable log levels.
        const prog = $.progress(msg, {length, noClear}).kind(kind)

        return {
            end: end => logEnd(end, event, prog),
            bytesCopied: bytes => {
                prog.increment(bytes)
            },
            incrementProgress: () => {
                prog.increment(1)
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
