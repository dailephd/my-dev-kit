package com.example.combined

data object HomeRoute

private const val SETTINGS_ROUTE = "settings"

fun ComposeHomeScreen() {
}

fun ComposeSettingsScreen() {
}

fun AppNavHost(navController: NavHostController) {
    NavHost(
        navController = navController,
        startDestination = "compose_home"
    ) {
        composable("compose_home") {
            ComposeHomeScreen()
        }
        composable<HomeRoute>() {
            ComposeHomeScreen()
        }
        composable(route = SETTINGS_ROUTE) {
            ComposeSettingsScreen()
        }
        dialog("confirm_dialog") {
            ConfirmDialog()
        }
        navigation(startDestination = "child_home", route = "nested_compose_graph") {
            composable("child_home") {
                ComposeHomeScreen()
            }
        }
        composable(dynamicRouteName()) {
            ComposeHomeScreen()
        }
        composable("ambiguous_route") {
            if (isLoggedIn) {
                ComposeHomeScreen()
            } else {
                ComposeSettingsScreen()
            }
        }
    }
}
