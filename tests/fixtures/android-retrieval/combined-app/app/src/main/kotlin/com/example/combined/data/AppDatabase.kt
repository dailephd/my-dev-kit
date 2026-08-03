package com.example.combined.data

import androidx.room.Database
import androidx.room.RoomDatabase

@Database
abstract class AppDatabase : RoomDatabase() {
    abstract fun userDao(): UserDao
}
