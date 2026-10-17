package com.example.kitdemo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun UserHomeScreen(viewModel: UserViewModel, onOpenSettings: () -> Unit = {}) {
    val uiState = viewModel.uiState.collectAsState()

    Column(modifier = Modifier.padding(16.dp)) {
        Text(stringResource(R.string.user_screen_title))
        Text("Loaded users: ${uiState.value.users.size}")
        Button(
            onClick = { viewModel.refreshUsers() },
            modifier = Modifier.testTag("refresh_users_button")
        ) {
            Text(stringResource(R.string.refresh_users_label))
        }
        Button(onClick = onOpenSettings) {
            Text(stringResource(R.string.settings_title))
        }
    }
}
