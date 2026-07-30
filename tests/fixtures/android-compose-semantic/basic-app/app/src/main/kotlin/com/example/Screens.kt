package com.example

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview

@Composable
fun HomeScreen() {
    Scaffold {
        Greeting()
    }
}

@Composable
fun Greeting() {
    Text("hi")
}

@Preview
@Composable
fun HomeScreenPreview() {
    HomeScreen()
}

private fun helperNotComposable(): Int = 1
