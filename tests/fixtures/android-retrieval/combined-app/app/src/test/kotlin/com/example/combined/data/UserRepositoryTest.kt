package com.example.combined.data

import org.junit.Test

class UserRepositoryTest {
    private val dao = mockk<UserDao>()
    private val api = mockk<UserApiService>()
    private val repository = mockk<UserRepository>()

    @Test
    fun insertsUserEntity() {
        val user = UserEntity()
        dao.insert(user)
    }
}
