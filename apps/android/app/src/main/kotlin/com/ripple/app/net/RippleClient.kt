package com.ripple.app.net

import com.ripple.core.RippleCrypto
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.SecretKey

/** A peer's view of another device in the room. */
data class Member(val id: String, val role: String, val isHost: Boolean, val device: String?)

/** One line of the shared, decrypted conversation. [mine] = sent from this device. */
data class ChatMessage(
    val id: Long,
    val cid: String?,
    val text: String,
    val t: Long,
    val mine: Boolean,
    val pending: Boolean = false,
)

enum class ConnState { Idle, Connecting, Connected, Reconnecting, Closed }

/** Everything the UI layer needs to know, pushed as it happens. */
sealed interface RippleEvent {
    data class Status(val state: ConnState) : RippleEvent
    /** Decrypted message from another device. */
    data class Incoming(val message: ChatMessage) : RippleEvent
    /** Our send was stored by the relay; pair it back to the pending bubble by [cid]. */
    data class Acked(val cid: String?, val id: Long, val t: Long, val delivered: Int) : RippleEvent
    data class History(val messages: List<ChatMessage>) : RippleEvent
    data class Presence(val members: List<Member>, val open: Boolean, val hostDid: String?) : RippleEvent
    /** A non-fatal heads-up to show the user (e.g. an undecryptable message). */
    data class Notice(val text: String) : RippleEvent
    object Cleared : RippleEvent
    /** Connection ended and must not auto-reconnect (kicked / full / locked / destroyed). */
    data class Terminal(val reason: String) : RippleEvent
}

/**
 * The single networking surface for the Ripple app — one OkHttp WebSocket speaking
 * the relay protocol (see HANDOFF §4 / docs/protocol.md). Built to be owned by a
 * foreground Service later so the IME and the app share one live socket; for now a
 * ViewModel owns it.
 *
 * Privacy + speed are load-bearing: only a room *hash* and AES-GCM *sealed* blobs
 * ever leave the device, and [send] never blocks on the network — it seals, fires
 * the frame asynchronously, and the caller paints the bubble optimistically.
 */
class RippleClient(
    private val did: String,
    private val relayBase: String = DEFAULT_RELAY,
    private val onEvent: (RippleEvent) -> Unit,
) {
    companion object {
        // The hostname keeps the old "yap" slug on purpose (invisible to users).
        const val DEFAULT_RELAY = "wss://yap-mkk4.onrender.com"
        private const val MAX_BACKOFF_MS = 15_000L
    }

    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)   // keep the socket warm; detect dead links
        .retryOnConnectionFailure(true)
        .build()

    private val cidSeq = AtomicInteger(0)

    // A generation guards against a stale listener resurrecting a closed session.
    private val generation = AtomicInteger(0)

    @Volatile private var socket: WebSocket? = null
    @Volatile private var room: String? = null
    @Volatile private var key: SecretKey? = null
    @Volatile private var code: String? = null
    @Volatile private var backoff = 1_000L
    @Volatile private var terminal = false

    val isConnected: Boolean get() = socket != null

    /** Derive room + key from the pairing code and open the socket. */
    fun connect(pairingCode: String) {
        val normalized = RippleCrypto.normalizeCode(pairingCode)
        code = normalized
        room = RippleCrypto.roomFromCode(normalized)
        key = RippleCrypto.keyFromCode(normalized)
        terminal = false
        backoff = 1_000L
        generation.incrementAndGet()
        openSocket()
    }

    private fun openSocket() {
        val r = room ?: return
        onEvent(RippleEvent.Status(if (socket == null) ConnState.Connecting else ConnState.Reconnecting))
        val url = "$relayBase/ws?role=phone&room=$r&did=$did"
        val request = Request.Builder().url(url).build()
        val myGen = generation.get()
        http.newWebSocket(request, Listener(myGen))
    }

    /** Seal [text] and send it. Returns the [ChatMessage] to paint immediately. */
    fun send(text: String): ChatMessage? {
        val k = key ?: return null
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        val cid = "a" + cidSeq.incrementAndGet()
        val sealed = RippleCrypto.seal(k, trimmed)
        val frame = JSONObject()
            .put("type", "text")
            .put("text", sealed)
            .put("cid", cid)
        socket?.send(frame.toString())   // async; never blocks the caller
        return ChatMessage(id = -1, cid = cid, text = trimmed, t = System.currentTimeMillis(), mine = true, pending = true)
    }

    fun disconnect() {
        terminal = true
        generation.incrementAndGet()
        socket?.close(1000, null)
        socket = null
        onEvent(RippleEvent.Status(ConnState.Closed))
    }

    private fun scheduleReconnect(gen: Int) {
        if (terminal || gen != generation.get()) return
        val delay = backoff
        backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
        Thread {
            try { Thread.sleep(delay) } catch (_: InterruptedException) { return@Thread }
            if (!terminal && gen == generation.get()) openSocket()
        }.start()
    }

    private inner class Listener(private val gen: Int) : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            if (gen != generation.get()) { ws.close(1000, null); return }
            socket = ws
            backoff = 1_000L
            onEvent(RippleEvent.Status(ConnState.Connected))
        }

        override fun onMessage(ws: WebSocket, textFrame: String) {
            if (gen != generation.get()) return
            val msg = try { JSONObject(textFrame) } catch (_: Exception) { return }
            when (msg.optString("type")) {
                "joined", "presence" -> emitPresence(msg)
                "history" -> emitHistory(msg)
                "text" -> emitIncoming(msg)
                "ack" -> onEvent(
                    RippleEvent.Acked(
                        cid = msg.optString("cid").ifEmpty { null },
                        id = msg.optLong("id"),
                        t = msg.optLong("t"),
                        delivered = msg.optInt("delivered"),
                    )
                )
                "cleared" -> onEvent(RippleEvent.Cleared)
                "kicked" -> terminate("You were removed from this room.")
                "destroyed" -> terminate("This room was closed by its host.")
                "error" -> {
                    val codeStr = msg.optString("code")
                    val text = msg.optString("message").ifEmpty { "Connection error." }
                    if (codeStr == "locked" || codeStr == "full") terminate(text)
                    else onEvent(RippleEvent.Notice(text))
                }
            }
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            ws.close(1000, null)
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (gen != generation.get()) return
            socket = null
            if (!terminal) { onEvent(RippleEvent.Status(ConnState.Reconnecting)); scheduleReconnect(gen) }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            if (gen != generation.get()) return
            socket = null
            if (!terminal) { onEvent(RippleEvent.Status(ConnState.Reconnecting)); scheduleReconnect(gen) }
        }
    }

    private fun terminate(reason: String) {
        terminal = true
        generation.incrementAndGet()
        socket?.close(1000, null)
        socket = null
        onEvent(RippleEvent.Terminal(reason))
    }

    private fun emitIncoming(msg: JSONObject) {
        val k = key ?: return
        val sealed = msg.optString("text")
        val plain = RippleCrypto.unseal(k, sealed)
        if (plain == null) {
            onEvent(RippleEvent.Notice("Couldn't read a message — are both devices on the same code?"))
            return
        }
        onEvent(
            RippleEvent.Incoming(
                ChatMessage(id = msg.optLong("id"), cid = null, text = plain, t = msg.optLong("t"), mine = false)
            )
        )
    }

    private fun emitHistory(msg: JSONObject) {
        val k = key ?: return
        val arr = msg.optJSONArray("messages") ?: return
        val out = ArrayList<ChatMessage>(arr.length())
        for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            val plain = RippleCrypto.unseal(k, m.optString("text")) ?: continue
            out.add(ChatMessage(id = m.optLong("id"), cid = null, text = plain, t = m.optLong("t"), mine = false))
        }
        onEvent(RippleEvent.History(out))
    }

    private fun emitPresence(msg: JSONObject) {
        val arr = msg.optJSONArray("members")
        val members = ArrayList<Member>()
        if (arr != null) for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            members.add(
                Member(
                    id = m.optString("id"),
                    role = m.optString("role"),
                    isHost = m.optBoolean("isHost"),
                    device = m.optString("device").ifEmpty { null },
                )
            )
        }
        onEvent(
            RippleEvent.Presence(
                members = members,
                open = msg.optBoolean("open", true),
                hostDid = msg.optString("hostDid").ifEmpty { null },
            )
        )
    }
}
