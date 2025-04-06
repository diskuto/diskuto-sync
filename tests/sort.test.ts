import { type ItemListEntry, ItemType } from "@diskuto/client/types";
import * as mod from "../src/sort.ts"
import { decodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import {assert } from "jsr:@std/assert@1.0.12"


Deno.test(function equality() {
    const a = ile(1740654000000, "38b3802ff20ce4844055cf76ec6f910cad6ccf8d2223e9461602b2851ea878aa6d89b0bd2b5b4e334b5c75aa6c60eae528123b17f06913cae6970f928d7ef207")
    const b = ile(1740654000000, "3d862caeed98fde5ece47fec47c810b2d9a86f131e41e9c583c71df429cd9eb3be1e573c76bf3e834edf1cf057e3658b55cc46b3ba19b2f65d441f0761ae5d0f")
    assert(mod.itemListEntryDesc(a, b) > 0)
    assert(mod.itemListEntryDesc(b, a) < 0)
    assert(mod.itemListEntryDesc(a, a) == 0)
    assert(mod.itemListEntryDesc(b, b) == 0)
})


function ile(ts: number, bytesHex: string): ItemListEntry {
    return {
        $typeName: "ItemListEntry",
        timestampMsUtc: BigInt(ts),
        itemType: ItemType.UNKNOWN,
        signature: {
            $typeName: "Signature",
            bytes: decodeHex(bytesHex)
        }
    }
}