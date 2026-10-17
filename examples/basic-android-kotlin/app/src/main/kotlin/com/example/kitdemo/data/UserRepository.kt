package com.example.kitdemo.data

class UserRepository(
    private val dao: UserDao,
    private val api: UserApiService
) {
    suspend fun refreshUsers(): List<UserEntity> {
        val remoteUsers = api.listUsers()
        dao.insertAll(remoteUsers.map { UserEntity(id = it.id, displayName = it.name) })
        return dao.getUsers()
    }
}
