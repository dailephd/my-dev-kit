package com.example.combined

@Composable
fun UserHomeScreen() {
    val viewModel: UserViewModel = viewModel()
    val uiState = viewModel.uiState.collectAsState()
}
