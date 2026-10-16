package com.example.combined

@Composable
fun UserSettingsScreen() {
    val notificationsEnabled = remember { mutableStateOf(true) }
    Text("Settings")
}
