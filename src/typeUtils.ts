
export function assertSameShape<A, B>(_value: SameShape<A, B>): void {
    // empty
}

type SameShape<A, B> = [A] extends [B] ? [B] extends [A] ? true: false : false