package com.example

import androidx.room.Entity

@Entity(tableName = "users")
data class UserEntity(val id: String, val name: String)
