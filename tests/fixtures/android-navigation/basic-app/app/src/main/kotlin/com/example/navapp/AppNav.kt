package com.example.navapp

private const val HOME_ROUTE = "home"

fun AppNavHost(navController: NavHostController) {
    NavHost(
        navController = navController,
        startDestination = HOME_ROUTE
    ) {
        composable(HOME_ROUTE) {
            HomeScreen()
        }
        composable(route = "details/{id}") {
            DetailsScreen()
        }
    }
}
