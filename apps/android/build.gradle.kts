// Root build file. Plugin versions are declared here once (apply false) and the
// modules apply them without a version. Keep AGP/Kotlin/Compose-compiler in step:
// the Compose compiler plugin version must match the Kotlin version.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
}
