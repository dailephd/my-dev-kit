plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.app"
        minSdk = 24
        targetSdk = 34
    }
}

dependencies {
    implementation(project(":core"))
}
