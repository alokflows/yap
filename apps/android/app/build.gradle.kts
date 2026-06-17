plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.ripple.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alokflows.ripple"   // same family as the desktop bundle id
        // minSdk 26: the shared crypto (packages/core-kt) uses java.util.Base64 and
        // PBKDF2WithHmacSHA256, both added to Android at API 26. Going lower would
        // require reimplementing the crypto, which must stay byte-identical.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    // Reuse the single source of truth for the crypto rather than copying it, so
    // RippleCrypto can never drift from the JS/Rust mirrors and the shared vectors.
    // (The Kotlin plugin compiles .kt found in java source dirs, so this is enough.)
    sourceSets["main"].java.srcDirs("../../../packages/core-kt/src/main/kotlin")

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // QR generation (pure-Java; no network, no camera). Mirrors web/desktop pairing.
    implementation("com.google.zxing:core:3.5.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
