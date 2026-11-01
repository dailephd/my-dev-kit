package fixtures.audit

import kotlin.collections.List
import java.util.*

class Outer {
    class NestedPublic {
    }
    private class NestedPrivate
    internal class NestedInternal {
    }
    protected open class NestedProtected {
    }
    companion object {
        const val ID = 1
    }
    object Registry {
    }
    interface Handler
}

internal object Singleton {
    companion object Named {
    }
}

private fun helper() = 1
fun publicFunction() = helper()
val topLevelValue = 2
data class Point(val x: Int, val y: Int)
