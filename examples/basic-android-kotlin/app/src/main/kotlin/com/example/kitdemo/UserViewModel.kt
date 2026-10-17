package com.example.kitdemo

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.kitdemo.data.UserEntity
import com.example.kitdemo.data.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class UserUiState(
    val users: List<UserEntity> = emptyList(),
    val isRefreshing: Boolean = false
)

class UserViewModel(
    private val repository: UserRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(UserUiState())
    val uiState: StateFlow<UserUiState> = _uiState.asStateFlow()

    fun refreshUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            val users = repository.refreshUsers()
            _uiState.update { it.copy(users = users, isRefreshing = false) }
        }
    }
}
