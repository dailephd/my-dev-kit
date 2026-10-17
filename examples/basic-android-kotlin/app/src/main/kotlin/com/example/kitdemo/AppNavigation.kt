package com.example.kitdemo

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun AppNavigation(userViewModel: UserViewModel) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = "home") {
        composable("home") {
            UserHomeScreen(
                viewModel = userViewModel,
                onOpenSettings = { navController.navigate("settings") }
            )
        }
        composable("settings") {
            UserSettingsScreen()
        }
    }
}
