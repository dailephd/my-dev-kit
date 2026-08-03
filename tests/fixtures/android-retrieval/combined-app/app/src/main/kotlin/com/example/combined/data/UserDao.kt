package com.example.combined.data

import androidx.room.Dao
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao {
    fun observeUsers(): Flow<List<UserEntity>>

    fun findUser(id: Long): UserEntity?

    fun insert(user: UserEntity)
}
