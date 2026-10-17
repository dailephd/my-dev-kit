package com.example.kitdemo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun UserSettingsScreen() {
    val notificationsEnabled = remember { mutableStateOf(true) }

    Column(modifier = Modifier.padding(16.dp)) {
        Text(stringResource(R.string.settings_title))
        Text(stringResource(R.string.notifications_label))
        Switch(
            checked = notificationsEnabled.value,
            onCheckedChange = { notificationsEnabled.value = it }
        )
    }
}
