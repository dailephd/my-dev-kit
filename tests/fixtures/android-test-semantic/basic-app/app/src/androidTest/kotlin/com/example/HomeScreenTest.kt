package com.example
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsLoginButtonAndWelcomeText() {
        composeTestRule.onNodeWithTag("login_button").assertExists()
        composeTestRule.onNodeWithText("Welcome back").assertExists()
    }
}
