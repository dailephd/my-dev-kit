package com.example

const val LOGIN_BUTTON_TAG = "login_button"

@Composable
fun HomeScreen(vm: LoginViewModel) {
    Text("Welcome back")
    Box(modifier = Modifier.testTag(LOGIN_BUTTON_TAG)) {}
}
