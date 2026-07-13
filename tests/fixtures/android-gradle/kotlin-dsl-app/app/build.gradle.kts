plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.kotlindsl"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.kotlindsl"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.0")
}
