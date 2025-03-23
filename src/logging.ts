/**
 * Defines the logging interfaces for {@link Sync}.
 * 
 * @module
 */

import type { UserID, Signature } from "@diskuto/client";
// deno-lint-ignore no-unused-vars
import type { Sync } from "./lib.ts";

/**
 * Implmenet this interface to customize logging with {@link Sync}.
 * 
 * This is designed so that it should be usable both in a CLI or in
 * a GUI.
 * 
 * Note: This interface may break semver conventions. Ex: If there is a new event to add to log,
 * I may add it (and thus break existing third-party implementations) without bumping the
 * MAJOR semver of the sync library. (IMO breaking here is better so you know to update implementations.)
 */
export type Logger = {
    /**
     * Called when a new log event starts.
     * 
     * Must return a {@link LogEntry} so that we can update the progress
     * of the event.
     */
    readonly start: (event: LogEvent) => LogEntry
}

/** Information passed to {@link Logger.start} when a log event starts. */
export type LogEvent = SyncProfile | SyncFeed | SyncUserItems | CopyItem | CopyFile | DebugInfo

/** Returned by {@link Logger.start} to allow signalling the end of a log event. */
export type LogEntry = {
    /**
     * Called when the log event has completed.
     */
    readonly end: (event: LogEnd) => void

    /**
     * Called for {@link CopyFile} events to update copy progress.
     */
    readonly bytesCopied: (chunkBytes: number) => void
}

/**
 * A {@link LogEvent} that we're beginning to sync a user's profile (only).
 * 
 * This usually happens at the beginning of a sync, at least for the "main" user,
 * so that we have an up-to-date list of their follows.
 */
export type SyncProfile = {
    type: "syncProfile"
    user: UserInfo
 }

/**
 * A {@link LogEvent} for syncing a user's feed.
 * 
 * This starts at the beginning of the process, and lasts until we've sync'd
 * the user's posts, and 
 */
export type SyncFeed = {
    type: "syncFeed"
    user: UserInfo
}

/**
 * Sync items for a particular user.
 */
export type SyncUserItems = {
    type: "syncUserItems"
    user: UserInfo
}

/**
 * A {@link LogEvent}
 */
export type CopyItem = {
    type: "copyItem"
    user: UserInfo
    signature: Signature
    src: ServerInfo
    dest: ServerInfo
 }

/**
 * A {@link LogEvent} showing that we're copying a file attachment.
 */
export type CopyFile = {
    type: "copyFile"

    /** The user that this file attachment belongs to. */
    user: UserInfo,
    /** The item signature that this file attachment belongs to. */
    signature: Signature

    /** Just the base filename, (ex: "foo.png", not a full URL. */
    fileName: string

    /** Size of the file in bytes. */
    totalBytes: number

    src: ServerInfo
    dest: ServerInfo
 }

/**
 * A {@link LogEvent} that should be output as a debug message.
 */
export type DebugInfo = {
    type: "debug"
    messageParts: unknown[]
 }

/**
 * Information about source/destination servers in {@link LogEvent}s.
 */
export type ServerInfo = {
    /** The URL to access this server's API. */
    url: string,

    /** A short name to refer to this server by when logging. */
    name?: string,

    /** Set to `true` to mark this server as a destination that should be updated by the sync. */
    isDest?: boolean
}

/**
 * Information about the user whose data we're copying in a {@link LogEvent}
 */
export type UserInfo = {
    id: UserID

    /**
     * The way that this user is known to the "main" sync user.
     * 
     * It should be the preferred display name when logging information about this user.
     * 
     * Ex: If Bob follows John, but names him "Johnny" in his "Follows" list, this will be
     * "Johnny".
     */
    knownName?: string

    /**
     * The name that this user specifies for themself.
     * 
     * May not be present in many circumstances. Should prefer {@link UserInfo.knownName}
     */
    displayName?: string
}



/**
 * Signals to {@link LogEntry.end} how an event ended.
 */
export type LogEnd = Success | Warning | Error

/** Everything was successful. */
type Success = {
    type: "success"
}

/**
 * Non-OK error condition that shouldn't stop progress.
 */
type Warning = {
    type: "warning"
    message: string
}

/**
 * Error condition that will stop progress.
 */
type Error = {
    type: "error"
    message: string
}