plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.sourcesets"
    compileSdk = 34

    sourceSets {
        main {
            manifest.srcFile("custom/AndroidManifest.xml")
            java.srcDirs("custom/java")
            res.srcDirs("custom/res")
        }
        test {
            java.srcDirs("custom/testJava")
        }
        androidTest {
            java.srcDirs("custom/androidTestJava")
        }
    }
}
