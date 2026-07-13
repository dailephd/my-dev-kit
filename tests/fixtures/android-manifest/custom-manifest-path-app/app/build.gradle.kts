plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.custompath"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.custompath"
        minSdk = 24
        targetSdk = 34
    }

    sourceSets {
        main {
            manifest.srcFile("custom/CustomManifest.xml")
        }
    }
}
