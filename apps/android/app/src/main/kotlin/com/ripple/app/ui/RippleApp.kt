package com.ripple.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ripple.app.RippleViewModel
import com.ripple.app.Screen
import com.ripple.app.UiState
import com.ripple.app.net.ChatMessage
import com.ripple.app.net.ConnState
import com.ripple.app.util.QrCodes
import kotlin.random.Random

@Composable
fun RippleApp(vm: RippleViewModel) {
    val ui by vm.ui.collectAsState()
    RippleTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when (ui.screen) {
                Screen.Connect -> ConnectScreen(onConnect = vm::connect)
                Screen.Chat -> ChatScreen(ui = ui, onSend = vm::send, onLeave = vm::leave, onDismissNotice = vm::dismissNotice)
            }
        }
    }
}

@Composable
private fun ConnectScreen(onConnect: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🗣️ Ripple", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(8.dp))
        Text(
            "Type or talk on one device — it lands at the cursor on another. Share a code to pair.",
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.uppercase() },
            label = { Text("Pairing code") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().widthIn(max = 360.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { if (code.isNotBlank()) onConnect(code) }),
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { if (code.isNotBlank()) onConnect(code) },
            enabled = code.isNotBlank(),
            modifier = Modifier.fillMaxWidth().widthIn(max = 360.dp),
        ) { Text("Connect") }
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = { code = randomCode() }) { Text("Create a new code") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatScreen(
    ui: UiState,
    onSend: (String) -> Unit,
    onLeave: () -> Unit,
    onDismissNotice: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    var showQr by remember { mutableStateOf(false) }
    LaunchedEffect(ui.notice) {
        ui.notice?.let { snackbar.showSnackbar(it); onDismissNotice() }
    }
    if (showQr && ui.code.isNotEmpty()) QrDialog(code = ui.code, onDismiss = { showQr = false })
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Code ${ui.code}", fontWeight = FontWeight.SemiBold)
                        Text(statusLine(ui), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onLeave) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Leave")
                    }
                },
                actions = {
                    IconButton(onClick = { showQr = true }, enabled = ui.code.isNotEmpty()) {
                        Icon(Icons.Filled.QrCode2, contentDescription = "Show pairing QR")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if (ui.terminal != null) {
                Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.errorContainer).padding(12.dp)) {
                    Text(ui.terminal, color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
            MessageList(ui.messages, Modifier.weight(1f))
            if (ui.terminal == null) Composer(onSend)
        }
    }
}

@Composable
private fun MessageList(messages: List<ChatMessage>, modifier: Modifier) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }
    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(messages, key = { it.cid ?: "s${it.id}" }) { Bubble(it) }
    }
}

@Composable
private fun Bubble(m: ChatMessage) {
    val mine = m.mine
    val bg = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = bg,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Text(
                m.text + if (m.pending) "  …" else "",
                color = fg,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun Composer(onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Row(
        Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Type a message") },
            modifier = Modifier.weight(1f),
            maxLines = 4,
        )
        IconButton(
            onClick = { if (text.isNotBlank()) { onSend(text); text = "" } },
            enabled = text.isNotBlank(),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun QrDialog(code: String, onDismiss: () -> Unit) {
    // Generated once per code; encodes the same /?room=CODE link as web/desktop,
    // so any Ripple client (or a phone camera) can scan it to join.
    val qr = remember(code) { QrCodes.pairing(code, 480).asImageBitmap() }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
        title = { Text("Scan to connect") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(color = androidx.compose.ui.graphics.Color.White, shape = RoundedCornerShape(12.dp)) {
                    Image(
                        bitmap = qr,
                        contentDescription = "Pairing QR for code $code",
                        modifier = Modifier.padding(12.dp).size(240.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Text("Code $code", fontWeight = FontWeight.SemiBold)
                Text(
                    "Point another device's camera here — it joins instantly.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        },
    )
}

private fun statusLine(ui: UiState): String = when (ui.state) {
    ConnState.Idle -> "Not connected"
    ConnState.Connecting -> "Connecting…"
    ConnState.Connected -> {
        val others = ui.members.size - 1
        if (others > 0) "Connected · $others other device${if (others == 1) "" else "s"}" else "Connected · waiting for a device"
    }
    ConnState.Reconnecting -> "Reconnecting…"
    ConnState.Closed -> "Disconnected"
}

// Unambiguous alphabet (no 0/O, 1/I) so a spoken/handwritten code is unmistakable.
private const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
private fun randomCode(): String = buildString { repeat(6) { append(ALPHABET[Random.nextInt(ALPHABET.length)]) } }
