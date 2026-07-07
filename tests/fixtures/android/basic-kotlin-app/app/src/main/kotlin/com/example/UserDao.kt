package com.example

import androidx.room.Dao

@Dao
interface UserDao {
    fun findAll(): List<UserEntity>
}
