package com.example.models;

import java.util.List;
import static java.util.Collections.emptyList;
import java.util.function.*;

public record User(String id, String name) {
}

sealed interface Result permits Success, Failure {
}

final class Success implements Result {
}

final class Failure implements Result {
}

public interface Repository {
    List<User> findAll();
}

@Deprecated
public class UserService implements Repository {
    public List<User> findAll() {
        return emptyList();
    }
}

public enum Status {
    ACTIVE, INACTIVE, PENDING
}

@interface Important {
}
