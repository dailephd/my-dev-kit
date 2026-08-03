package com.example.combined.data

class UserRepository(
    private val dao: UserDao,
    private val api: UserApiService
)
