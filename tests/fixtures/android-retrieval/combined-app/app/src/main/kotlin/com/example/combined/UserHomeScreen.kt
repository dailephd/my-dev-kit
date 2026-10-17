package com.example.combined

@Composable
fun UserHomeScreen() {
    val viewModel: UserViewModel = viewModel()
    val uiState = viewModel.uiState.collectAsState()
    Text(stringResource(R.string.user_screen_title))
    Text(uiState.value)
    Button(
        onClick = { viewModel.refreshUsers() },
        modifier = Modifier.testTag("refresh_users_button")
    ) {
        Text("Refresh")
    }
}
