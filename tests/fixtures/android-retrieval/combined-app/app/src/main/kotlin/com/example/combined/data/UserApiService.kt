package com.example.combined.data

import retrofit2.http.GET

interface UserApiService {
    @GET("users")
    fun listUsers(): List<UserEntity>
}
