// Standalone JVM build for the Kotlin crypto mirror, so the cross-language
// vectors can be tested without the full Android toolchain:  gradle test
// The Android app can either depend on this module or include Crypto.kt directly.
plugins {
    kotlin("jvm") version "2.1.0"
}

repositories { mavenCentral() }

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test { useJUnitPlatform() }

kotlin { jvmToolchain(17) }
