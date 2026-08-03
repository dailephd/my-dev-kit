package com.example.combined

import androidx.lifecycle.ViewModel
import com.example.combined.data.UserRepository

class UserViewModel(
    private val repository: UserRepository
) : ViewModel()
