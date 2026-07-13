plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.customres"
    compileSdk = 34

    sourceSets {
        main {
            res.srcDirs("custom/myres")
        }
    }
}
