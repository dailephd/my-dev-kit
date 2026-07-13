plugins {
    id("com.android.application")
}

val myMinSdk = 24

android {
    namespace = "com.example.dynamic"
    compileSdk = rootProject.extra["compileSdkFromRoot"] as Int

    defaultConfig {
        applicationId = "com.example.dynamic"
        minSdk = myMinSdk
        targetSdk = project.property("targetSdkVersion") as Int
        versionName = "v" + getVersionName()
    }
}
