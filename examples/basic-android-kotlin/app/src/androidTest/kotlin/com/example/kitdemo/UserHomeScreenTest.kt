package com.example.kitdemo

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.kitdemo.data.UserApiService
import com.example.kitdemo.data.UserDao
import com.example.kitdemo.data.UserDto
import com.example.kitdemo.data.UserEntity
import com.example.kitdemo.data.UserRepository
import org.junit.Rule
import org.junit.Test

class UserHomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private class FakeUserDao : UserDao {
        private val stored = mutableListOf<UserEntity>()

        override suspend fun getUsers(): List<UserEntity> = stored.toList()

        override suspend fun insertAll(users: List<UserEntity>) {
            stored.clear()
            stored.addAll(users)
        }
    }

    private class FakeUserApiService : UserApiService {
        override suspend fun listUsers(): List<UserDto> = listOf(UserDto(id = 1, name = "Ada"))
    }

    @Test
    fun showsTitleAndRefreshButton() {
        val viewModel = UserViewModel(UserRepository(FakeUserDao(), FakeUserApiService()))
        composeTestRule.setContent {
            UserHomeScreen(viewModel = viewModel)
        }

        composeTestRule.onNodeWithText("Users").assertIsDisplayed()
        composeTestRule.onNodeWithTag("refresh_users_button").assertIsDisplayed()
    }

    @Test
    fun refreshButtonIsClickable() {
        val viewModel = UserViewModel(UserRepository(FakeUserDao(), FakeUserApiService()))
        composeTestRule.setContent {
            UserHomeScreen(viewModel = viewModel)
        }

        composeTestRule.onNodeWithTag("refresh_users_button").performClick()
    }
}
