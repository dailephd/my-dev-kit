package com.example

const val LOGIN_BUTTON_TAG = "login_button"

@Composable
fun HomeScreen(vm: LoginViewModel, nav: Any) {
    val counter by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        doWork()
    }
    Text("Welcome back")
    Text(stringResource(R.string.greeting))
    Box(modifier = Modifier.testTag(LOGIN_BUTTON_TAG)) {}
    Button(onClick = { nav.navigate("settings") }) {
        Text("Go to settings")
    }
    Button(onClick = { nav.navigate("duplicate") }) {
        Text("Go to duplicate")
    }
    Button(onClick = { nav.navigate("unknown_route") }) {
        Text("Broken link")
    }
    ChildScreen()
}

@Composable
fun ChildScreen() {
    Text("Child content")
}

@Preview
@Composable
fun HomeScreenPreview() {
    HomeScreen(vm = LoginViewModel(), nav = Unit)
}
