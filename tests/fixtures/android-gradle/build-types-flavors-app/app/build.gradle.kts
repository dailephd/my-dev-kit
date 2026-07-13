plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.flavors"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.flavors"
        minSdk = 24
        targetSdk = 34
        versionCode = computeVersionCode()
        versionName = "1.0"
    }

    flavorDimensions += listOf("tier")

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            debuggable = true
        }
        release {
            minifyEnabled = true
            shrinkResources = true
        }
    }

    productFlavors {
        free {
            dimension = "tier"
            applicationIdSuffix = ".free"
        }
        paid {
            dimension = "tier"
            applicationId = "com.example.flavors.paid"
        }
    }
}
