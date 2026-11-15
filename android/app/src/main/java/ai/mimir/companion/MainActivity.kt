package ai.mimir.companion

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private val MimirBg = Color(0xFF081019)
private val MimirSurface = Color(0xFF0F1A28)
private val MimirSurfaceAlt = Color(0xFF152436)
private val MimirBrass = Color(0xFFE8B85C)
private val MimirFrost = Color(0xFF5EEAD4)
private val MimirInk = Color(0xFFEAF2F8)
private val MimirMuted = Color(0xFF9FB3C8)
private val MimirDanger = Color(0xFFEF4444)

private val MimirDarkScheme = darkColorScheme(
    primary = MimirFrost,
    onPrimary = MimirBg,
    secondary = MimirBrass,
    onSecondary = MimirBg,
    background = MimirBg,
    onBackground = MimirInk,
    surface = MimirSurface,
    onSurface = MimirInk,
    surfaceVariant = MimirSurfaceAlt,
    onSurfaceVariant = MimirMuted,
    error = MimirDanger,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val rustVer = MimirNativeBridge.safeSecurityVersion()
        setContent {
            MaterialTheme(colorScheme = MimirDarkScheme) {
                MimirCompanionApp(rustVersion = rustVer)
            }
        }
    }
}

@Composable
fun MimirCompanionApp(rustVersion: String) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("mimir_companion", Context.MODE_PRIVATE) }
    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", "http://10.0.2.2:4567") ?: "http://10.0.2.2:4567") }
    var authToken by remember { mutableStateOf(prefs.getString("auth_token", "") ?: "") }
    var activeTab by remember { mutableIntStateOf(0) }
    var isSyncing by remember { mutableStateOf(false) }
    var statusBanner by remember { mutableStateOf("Ready to pair with local or LAN coordinator") }
    var snapshot by remember {
        mutableStateOf(
            SyncSnapshot(
                online = false,
                statusText = "Waiting for initial sync",
                approvals = emptyList(),
                artifacts = emptyList(),
                realms = emptyList(),
                totalMapNodes = 0,
            )
        )
    }
    var redactInput by remember { mutableStateOf("Authorization: Bearer sk-mimir-test-secret-123456") }
    val redactedPreview = remember(redactInput) { MimirNativeBridge.safeRedactText(redactInput) }
    val scope = rememberCoroutineScope()
    var syncJob by remember { mutableStateOf<Job?>(null) }

    fun refreshSync() {
        prefs.edit().putString("server_url", serverUrl).putString("auth_token", authToken).apply()
        syncJob?.cancel()
        syncJob = scope.launch {
            isSyncing = true
            val next = MimirClient.syncAll(serverUrl, authToken)
            snapshot = next
            statusBanner = next.statusText
            isSyncing = false
        }
    }

    LaunchedEffect(Unit) {
        refreshSync()
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding(),
        containerColor = MimirBg,
        bottomBar = {
            NavigationBar(containerColor = MimirSurface) {
                NavigationBarItem(
                    selected = activeTab == 0,
                    onClick = { activeTab = 0 },
                    label = { Text("Needs OK (${snapshot.approvals.size})") },
                    icon = { Text("OK", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace) },
                )
                NavigationBarItem(
                    selected = activeTab == 1,
                    onClick = { activeTab = 1 },
                    label = { Text("Library (${snapshot.artifacts.size})") },
                    icon = { Text("LIB", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace) },
                )
                NavigationBarItem(
                    selected = activeTab == 2,
                    onClick = { activeTab = 2 },
                    label = { Text("Realms & FFI") },
                    icon = { Text("MAP", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace) },
                )
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
        ) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MimirSurface),
                    border = BorderStroke(1.dp, MimirBrass.copy(alpha = 0.7f)),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "MIMIR COMPANION",
                                    color = MimirBrass,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 16.sp,
                                )
                                Text(
                                    text = "Rust JNI: $rustVersion",
                                    color = MimirFrost,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                )
                            }
                            Button(
                                onClick = {
                                    scope.launch {
                                        MimirClient.triggerKillSwitch(serverUrl, authToken)
                                            .onSuccess { stopped ->
                                                statusBanner = "Kill switch pulled ($stopped active runs stopped)"
                                                refreshSync()
                                            }
                                            .onFailure { err ->
                                                statusBanner = "Kill switch failed: ${err.message}"
                                            }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = MimirDanger, contentColor = Color.White),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                            ) {
                                Text("STOP ALL", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            }
                        }
                        Text(
                            text = statusBanner,
                            color = if (snapshot.online) MimirFrost else MimirMuted,
                            fontSize = 12.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MimirSurfaceAlt),
                    border = BorderStroke(1.dp, Color(0xFF283B52)),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = { serverUrl = it },
                            label = { Text("Coordinator URL (LAN / Tailscale / 10.0.2.2)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = authToken,
                                onValueChange = { authToken = it },
                                label = { Text("Pairing Token (optional)") },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                modifier = Modifier.weight(1f),
                            )
                            Button(
                                onClick = { refreshSync() },
                                enabled = !isSyncing,
                                modifier = Modifier.height(50.dp),
                            ) {
                                Text(if (isSyncing) "..." else "Sync")
                            }
                        }
                    }
                }
            }

            when (activeTab) {
                0 -> {
                    if (snapshot.approvals.isEmpty()) {
                        item {
                            EmptyStateCard(
                                title = "Needs your OK · Clear",
                                subtitle = if (snapshot.online) {
                                    "No tools or outbound messages waiting on approval right now."
                                } else {
                                    "Start Mimir coordinator on desktop or enter your LAN IP, then tap Sync."
                                },
                            )
                        }
                    } else {
                        items(snapshot.approvals, key = { it.id }) { apr ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = MimirSurface),
                                border = BorderStroke(1.dp, MimirBrass.copy(alpha = 0.6f)),
                            ) {
                                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("Needs your OK", color = MimirBrass, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    Text(apr.title, color = MimirInk, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                    Text(apr.subtitle, color = MimirMuted, fontSize = 13.sp)
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    MimirClient.decideApproval(serverUrl, authToken, apr.id, "approve-once")
                                                        .onSuccess { refreshSync() }
                                                        .onFailure { statusBanner = "Approve failed: ${it.message}" }
                                                }
                                            },
                                        ) {
                                            Text(apr.primaryLabel)
                                        }
                                        OutlinedButton(
                                            onClick = {
                                                scope.launch {
                                                    MimirClient.decideApproval(serverUrl, authToken, apr.id, "deny")
                                                        .onSuccess { refreshSync() }
                                                        .onFailure { statusBanner = "Deny failed: ${it.message}" }
                                                }
                                            },
                                        ) {
                                            Text(apr.secondaryLabel)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                1 -> {
                    if (snapshot.artifacts.isEmpty()) {
                        item {
                            EmptyStateCard(
                                title = "Library Deliverables",
                                subtitle = "Generated PDF, DOCX, PPTX, XLSX, SVG, PNG & ZIP deliverables appear here once synced.",
                            )
                        }
                    } else {
                        items(snapshot.artifacts, key = { it.id }) { art ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = MimirSurface),
                                border = BorderStroke(1.dp, Color(0xFF283B52)),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(14.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(art.format, color = MimirFrost, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        Text(art.title, color = MimirInk, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                    Text("${art.sizeBytes} B", color = MimirMuted, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }

                else -> {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MimirSurface),
                            border = BorderStroke(1.dp, MimirFrost.copy(alpha = 0.5f)),
                        ) {
                            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Rust FFI Redaction Verification", color = MimirFrost, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                OutlinedTextField(
                                    value = redactInput,
                                    onValueChange = { redactInput = it },
                                    label = { Text("Sample Secret Payload") },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Text(
                                    text = "Redacted via mimir-ffi.so:\n$redactedPreview",
                                    color = MimirInk,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                    item {
                        EmptyStateCard(
                            title = "Nine Realms Telemetry (${snapshot.totalMapNodes} nodes)",
                            subtitle = if (snapshot.realms.isEmpty()) {
                                "Sync with coordinator to view Midgard Nine-Realms project distribution."
                            } else {
                                snapshot.realms.joinToString(" · ") { "${it.name}: ${it.nodeCount}" }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyStateCard(title: String, subtitle: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MimirSurface),
        border = BorderStroke(1.dp, Color(0xFF283B52)),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, color = MimirInk, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, color = MimirMuted, fontSize = 13.sp)
        }
    }
}
