package ai.mimir.companion

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class ApprovalItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val primaryLabel: String,
    val secondaryLabel: String,
)

data class ArtifactItem(
    val id: String,
    val title: String,
    val format: String,
    val sizeBytes: Long,
)

data class RealmSummary(
    val id: String,
    val name: String,
    val nodeCount: Int,
)

data class SyncSnapshot(
    val online: Boolean,
    val statusText: String,
    val approvals: List<ApprovalItem>,
    val artifacts: List<ArtifactItem>,
    val realms: List<RealmSummary>,
    val totalMapNodes: Int,
)

object MimirClient {
    fun parseApprovals(raw: String): List<ApprovalItem> {
        val trimmed = raw.trim()
        val arr = if (trimmed.startsWith("[")) {
            JSONArray(trimmed)
        } else {
            JSONObject(trimmed).optJSONArray("approvals") ?: JSONArray()
        }
        return buildList {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val card = obj.optJSONObject("dialogueCard")
                val id = obj.optString("id", "apr-$i")
                val title = card?.optString("title")?.takeIf { it.isNotBlank() }
                    ?: obj.optString("toolName", "").ifBlank { obj.optString("tool", "Pending Action") }
                val subtitle = card?.optString("subtitle")?.takeIf { it.isNotBlank() }
                    ?: obj.optString("reason", obj.optString("command", "Needs your OK"))
                val primary = card?.optString("primaryLabel")?.takeIf { it.isNotBlank() } ?: "Approve Once"
                val secondary = card?.optString("secondaryLabel")?.takeIf { it.isNotBlank() } ?: "Deny"
                add(ApprovalItem(id, title, subtitle, primary, secondary))
            }
        }
    }

    fun parseArtifacts(raw: String): List<ArtifactItem> {
        val trimmed = raw.trim()
        val arr = if (trimmed.startsWith("[")) {
            JSONArray(trimmed)
        } else {
            JSONObject(trimmed).optJSONArray("artifacts") ?: JSONArray()
        }
        return buildList {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                add(
                    ArtifactItem(
                        id = obj.optString("id", "art-$i"),
                        title = obj.optString("title", "Untitled Deliverable"),
                        format = obj.optString("format", "file").uppercase(),
                        sizeBytes = obj.optLong("size_bytes", obj.optLong("bytes", 0L)),
                    )
                )
            }
        }
    }

    fun parseRealms(raw: String): Pair<List<RealmSummary>, Int> {
        val root = JSONObject(raw)
        val realmsArr = root.optJSONArray("realms") ?: JSONArray()
        val nodesArr = root.optJSONArray("nodes") ?: JSONArray()
        val counts = mutableMapOf<String, Int>()
        for (i in 0 until nodesArr.length()) {
            val n = nodesArr.optJSONObject(i) ?: continue
            val r = n.optString("realmId", "").ifBlank { n.optString("realm", "") }
            if (r.isNotBlank()) counts[r] = (counts[r] ?: 0) + 1
        }
        val realms = buildList {
            for (i in 0 until realmsArr.length()) {
                val r = realmsArr.optJSONObject(i) ?: continue
                val id = r.optString("id", "realm-$i")
                val name = r.optString("name", id)
                add(RealmSummary(id, name, counts[id] ?: 0))
            }
        }
        return realms to nodesArr.length()
    }

    private fun request(baseUrl: String, path: String, token: String, method: String = "GET", bodyJson: String? = null): String {
        val cleanBase = baseUrl.trim().trimEnd('/')
        val conn = (URL("$cleanBase$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 3500
            readTimeout = 5000
            setRequestProperty("Accept", "application/json")
            if (token.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer ${token.trim()}")
            }
            if (bodyJson != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (bodyJson != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(bodyJson) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code: ${text.take(120)}")
            }
            return text
        } finally {
            conn.disconnect()
        }
    }

    suspend fun syncAll(baseUrl: String, token: String): SyncSnapshot = withContext(Dispatchers.IO) {
        try {
            val meta = JSONObject(request(baseUrl, "/v1/meta", token))
            val approvals = parseApprovals(request(baseUrl, "/v1/approvals", token))
            val artifacts = parseArtifacts(request(baseUrl, "/v1/library/artifacts", token))
            val (realms, nodeCount) = parseRealms(request(baseUrl, "/v1/projects/map", token))
            val version = meta.optString("version", "").ifBlank { "Live" }
            SyncSnapshot(
                online = true,
                statusText = "Connected · Coordinator $version",
                approvals = approvals,
                artifacts = artifacts,
                realms = realms,
                totalMapNodes = nodeCount,
            )
        } catch (err: CancellationException) {
            throw err
        } catch (err: Throwable) {
            SyncSnapshot(
                online = false,
                statusText = "Offline · ${err.message ?: "Coordinator unreachable"}",
                approvals = emptyList(),
                artifacts = emptyList(),
                realms = emptyList(),
                totalMapNodes = 0,
            )
        }
    }

    suspend fun decideApproval(baseUrl: String, token: String, approvalId: String, decision: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                val payload = JSONObject().put("decision", decision).toString()
                val encodedId = URLEncoder.encode(approvalId, "UTF-8")
                request(baseUrl = baseUrl, path = "/v1/approvals/$encodedId", token = token, method = "POST", bodyJson = payload)
                Unit
            }.onFailure { if (it is CancellationException) throw it }
        }

    suspend fun triggerKillSwitch(baseUrl: String, token: String): Result<Int> =
        withContext(Dispatchers.IO) {
            runCatching {
                val out = JSONObject(request(baseUrl, "/v1/kill-switch", token, method = "POST", bodyJson = "{}"))
                out.optInt("runsKilled", out.optInt("stoppedCount", out.optInt("stopped", 0)))
            }.onFailure { if (it is CancellationException) throw it }
        }
}
