package com.example.models

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

data class User(val id: String, val name: String)

sealed class Result

interface Repository {
    fun findAll(): List<User>
}

object Registry {
    val version: String = "1.0"
}

enum class Status { ACTIVE, INACTIVE, PENDING }

class UserService {
    fun formatUser(user: User): String {
        return user.name
    }
}

val state: StateFlow<Int> = TODO()

fun observeUsers(): Flow<List<User>> = TODO()
