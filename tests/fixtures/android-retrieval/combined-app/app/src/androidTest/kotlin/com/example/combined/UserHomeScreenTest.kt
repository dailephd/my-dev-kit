package com.example.combined

import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class UserHomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsRefreshButtonAndTitle() {
        composeTestRule.onNodeWithTag("refresh_users_button").assertExists()
        composeTestRule.onNodeWithText("Users").assertExists()
    }
}
