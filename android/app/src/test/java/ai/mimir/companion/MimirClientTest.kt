package ai.mimir.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class MimirClientTest {
    @Test
    fun parsesApprovalsArraySafely() {
        val raw = """
            [
              {
                "id": "apr-1",
                "tool": "connector_send",
                "dialogueCard": {
                  "title": "GitHub Comment",
                  "subtitle": "Post issue reply",
                  "primaryLabel": "Send it",
                  "secondaryLabel": "Review first"
                }
              }
            ]
        """.trimIndent()
        val parsed = MimirClient.parseApprovals(raw)
        assertEquals(1, parsed.size)
        assertEquals("GitHub Comment", parsed[0].title)
        assertEquals("Send it", parsed[0].primaryLabel)
    }

    @Test
    fun parsesArtifactsEnvelopeSafely() {
        val raw = """
            {"artifacts":[{"id":"art-1","title":"Report","format":"pdf","size_bytes":4096}]}
        """.trimIndent()
        val parsed = MimirClient.parseArtifacts(raw)
        assertEquals(1, parsed.size)
        assertEquals("PDF", parsed[0].format)
        assertEquals(4096L, parsed[0].sizeBytes)
    }

    @Test
    fun parsesRealmsCountsByRealmId() {
        val raw = """
            {"realms":[{"id":"midgard","name":"Midgard"}],"nodes":[{"id":"n1","realmId":"midgard"}]}
        """.trimIndent()
        val (realms, total) = MimirClient.parseRealms(raw)
        assertEquals(1, total)
        assertEquals(1, realms[0].nodeCount)
    }

    @Test
    fun parsesToolNameFallbackAndApprovalsEnvelope() {
        val raw = """
            {"approvals":[{"id":"a2","toolName":"shell_exec","reason":"Run build"}]}
        """.trimIndent()
        val parsed = MimirClient.parseApprovals(raw)
        assertEquals(1, parsed.size)
        assertEquals("shell_exec", parsed[0].title)
        assertEquals("Run build", parsed[0].subtitle)
    }
}
