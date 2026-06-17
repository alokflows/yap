package com.ripple.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Asserts the SAME cross-language vectors as the JS (`crypto.test.mjs`) and Rust
 * (`core-rs`) suites — proving an Android client interoperates byte-for-byte.
 */
class CryptoTest {
    @Test fun roomVector() {
        assertEquals(
            "m5y7nOTrj9TE1Pbh9LSBNGFqitACsWIlLsKk8cfTqjg",
            RippleCrypto.roomFromCode("K7QF9P"),
        )
    }

    @Test fun sealVectorZeroIv() {
        val key = RippleCrypto.keyFromCode("K7QF9P")
        assertEquals(
            "AAAAAAAAAAAAAAAAA8gVxDfIR9jOqUCwRBdsU7oecTFk-DiEAtrwkOY",
            RippleCrypto.sealRaw(key, "hello, cursor", ByteArray(12)),
        )
    }

    @Test fun roundTripWithEmoji() {
        val key = RippleCrypto.keyFromCode("HELLO9")
        val sealed = RippleCrypto.seal(key, "type at the cursor 🎯")
        assertEquals("type at the cursor 🎯", RippleCrypto.unseal(key, sealed))
    }

    @Test fun wrongKeyReturnsNull() {
        val sealed = RippleCrypto.seal(RippleCrypto.keyFromCode("K7QF9P"), "secret")
        assertNull(RippleCrypto.unseal(RippleCrypto.keyFromCode("WRONG1"), sealed))
    }

    @Test fun normalizeIsCaseAndPunctuationInsensitive() {
        assertEquals("K7QF9P", RippleCrypto.normalizeCode("k7-qf 9p!"))
    }
}
