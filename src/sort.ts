import type { ItemListEntry } from "@diskuto/client/types";


/**
 * ascending Order by timestamp (asc), then signature (bytes)
 */
export function itemListEntry(a: ItemListEntry, b: ItemListEntry): number {
    const cmp = Number(a.timestampMsUtc - b.timestampMsUtc)
    if (cmp != 0) { return cmp }

    const aBytes = a.signature!.bytes
    const bBytes = b.signature!.bytes
    return bytes(aBytes, bBytes)
}

export function itemListEntryDesc(a: ItemListEntry, b: ItemListEntry): number {
    return -1 * itemListEntry(a, b)
}

function bytes(a: Uint8Array, b: Uint8Array) {
    const len = Math.min(a.length, b.length) 
    for (let i = 0; i < len; ++i) {
        const cmp = a[i] - b[i]
        if (cmp != 0) { return cmp }
    }

    // For Diskuto, these should always be the same, but just in case, the shortest is "first"
    return a.length - b.length
}