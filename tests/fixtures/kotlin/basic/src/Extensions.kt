package com.example.models

fun String.toSlug(): String {
    return this.lowercase().replace(" ", "-")
}

suspend fun fetchUser(id: String): User {
    return User(id, "unknown")
}
