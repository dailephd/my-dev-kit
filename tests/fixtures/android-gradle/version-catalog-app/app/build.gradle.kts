plugins {
    id("com.android.application")
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.example.catalog"
    compileSdk = 34
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.unresolved.alias)
}
