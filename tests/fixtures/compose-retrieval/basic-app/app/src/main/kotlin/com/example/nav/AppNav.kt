package com.example.nav

import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

@Composable
fun AppNav(navController: Any) {
    NavHost(navController = navController, startDestination = "home") {
        composable("home") { HomeScreenRoute() }
        composable("settings") { SettingsScreenRoute() }
        composable("duplicate") { DuplicateRouteScreenA() }
    }
}

@Composable
fun HomeScreenRoute() {}

@Composable
fun SettingsScreenRoute() {}

@Composable
fun DuplicateRouteScreenA() {}
