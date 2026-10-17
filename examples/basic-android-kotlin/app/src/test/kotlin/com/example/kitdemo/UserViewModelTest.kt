package com.example.kitdemo

import com.example.kitdemo.data.UserApiService
import com.example.kitdemo.data.UserDao
import com.example.kitdemo.data.UserDto
import com.example.kitdemo.data.UserEntity
import com.example.kitdemo.data.UserRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class UserViewModelTest {
    private class FakeUserDao : UserDao {
        val stored = mutableListOf<UserEntity>()

        override suspend fun getUsers(): List<UserEntity> = stored.toList()

        override suspend fun insertAll(users: List<UserEntity>) {
            stored.clear()
            stored.addAll(users)
        }
    }

    private class FakeUserApiService : UserApiService {
        override suspend fun listUsers(): List<UserDto> = listOf(UserDto(id = 1, name = "Ada"))
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun refreshUsersPublishesRepositoryResult() {
        val viewModel = UserViewModel(UserRepository(FakeUserDao(), FakeUserApiService()))

        viewModel.refreshUsers()

        assertEquals(listOf(UserEntity(id = 1, displayName = "Ada")), viewModel.uiState.value.users)
        assertFalse(viewModel.uiState.value.isRefreshing)
    }
}
