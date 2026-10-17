package com.example.kitdemo.data

import retrofit2.http.GET

data class UserDto(
    val id: Long,
    val name: String
)

interface UserApiService {
    @GET("users")
    suspend fun listUsers(): List<UserDto>
}
