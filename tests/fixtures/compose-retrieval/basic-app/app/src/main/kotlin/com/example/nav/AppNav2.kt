package com.example.nav

import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

@Composable
fun SecondaryNav(navController: Any) {
    NavHost(navController = navController, startDestination = "duplicate") {
        composable("duplicate") { DuplicateRouteScreenB() }
    }
}

@Composable
fun DuplicateRouteScreenB() {}
