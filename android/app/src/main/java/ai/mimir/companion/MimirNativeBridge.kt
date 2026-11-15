package ai.mimir.companion

object MimirNativeBridge {
    private val loaded: Boolean = try {
        System.loadLibrary("mimir_ffi")
        true
    } catch (_: Throwable) {
        false
    }

    external fun securityVersion(): String
    external fun redactText(input: String): String

    fun safeSecurityVersion(): String =
        if (!loaded) "mimir-ffi unavailable"
        else try {
            securityVersion()
        } catch (err: Throwable) {
            "jni-error: ${err.message ?: "unknown"}"
        }

    fun safeRedactText(input: String): String =
        if (!loaded) input
        else try {
            redactText(input)
        } catch (_: Throwable) {
            input
        }
}
