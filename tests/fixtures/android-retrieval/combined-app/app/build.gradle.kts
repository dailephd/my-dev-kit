plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.combined"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.combined"
        minSdk = 24
        targetSdk = 34
    }

    flavorDimensions += listOf("tier")
    productFlavors {
        free {
            dimension = "tier"
        }
        paid {
            dimension = "tier"
        }
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.core.ktx)
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation(resolveDynamicVersion())
}
