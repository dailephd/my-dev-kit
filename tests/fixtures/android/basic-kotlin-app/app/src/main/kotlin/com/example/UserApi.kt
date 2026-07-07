package com.example

import retrofit2.http.GET

interface UserApi {
    @GET("users")
    suspend fun getUsers(): List<UserEntity>
}
