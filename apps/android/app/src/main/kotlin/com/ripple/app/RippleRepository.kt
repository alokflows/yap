package com.ripple.app

import android.content.Context
import com.ripple.app.net.ChatMessage
import com.ripple.app.net.ConnState
import com.ripple.app.net.Member
import com.ripple.app.net.RippleClient
import com.ripple.app.net.RippleEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.security.SecureRandom
import java.util.Base64

/** The shared, observable connection state — one snapshot for the app *and* the IME. */
data class RippleState(
    val code: String = "",
    val state: ConnState = ConnState.Idle,
    val messages: List<ChatMessage> = emptyList(),
    val members: List<Member> = emptyList(),
    val open: Boolean = true,
    val notice: String? = null,
    val terminal: String? = null,
)

/**
 * Process-wide owner of the single Ripple socket. The container app and the
 * keyboard (IME) run in the same process and both talk to this one object, so
 * there is exactly one WebSocket and one shared history — pairing in the app
 * immediately lights up the keyboard. A foreground [RippleConnectionService]
 * keeps the process (and socket) alive while only the keyboard is on screen.
 */
object RippleRepository {
    private lateinit var app: Context
    @Volatile private var initialized = false

    /** Stable per-install device id (host model + locked rooms key on it). */
    lateinit var did: String
        private set

    private var client: RippleClient? = null

    private val _state = MutableStateFlow(RippleState())
    val state: StateFlow<RippleState> = _state.asStateFlow()

    val isConnected: Boolean get() = client?.isConnected == true
    val currentCode: String get() = _state.value.code

    /** The last code we paired with, remembered across launches (null if none). */
    val savedCode: String? get() = if (initialized) prefs().getString("code", null)?.takeIf { it.isNotBlank() } else null

    fun init(context: Context) {
        if (initialized) return
        app = context.applicationContext
        did = stableDid(app)
        initialized = true
    }

    fun connect(code: String) {
        val normalized = code.trim()
        if (normalized.isEmpty()) return
        prefs().edit().putString("code", normalized).apply()
        client?.disconnect()
        val c = RippleClient(did = did, onEvent = ::onEvent)
        client = c
        _state.update { RippleState(code = normalized) }
        c.connect(normalized)
        RippleConnectionService.start(app, normalized)
    }

    /** Re-pair with the remembered code on app start, so the user isn't asked again. */
    fun resume() {
        if (client == null) savedCode?.let { connect(it) }
    }

    /** Seal + send; returns the optimistic bubble (also appended to [state]). */
    fun send(text: String): ChatMessage? {
        val pending = client?.send(text) ?: return null
        _state.update { it.copy(messages = it.messages + pending) }
        return pending
    }

    fun leave() {
        client?.disconnect()
        client = null
        prefs().edit().remove("code").apply()
        _state.update { RippleState() }
        RippleConnectionService.stop(app)
    }

    private fun prefs() = app.getSharedPreferences("ripple", Context.MODE_PRIVATE)

    fun dismissNotice() = _state.update { it.copy(notice = null) }

    private fun onEvent(event: RippleEvent) {
        when (event) {
            is RippleEvent.Status -> _state.update { it.copy(state = event.state) }

            is RippleEvent.Incoming -> _state.update { it.copy(messages = it.messages + event.message) }

            is RippleEvent.History -> _state.update { s ->
                val mineKept = s.messages.filter { it.mine }
                s.copy(messages = (event.messages + mineKept).sortedBy { it.t })
            }

            is RippleEvent.Acked -> _state.update { s ->
                s.copy(messages = s.messages.map {
                    if (it.pending && it.cid == event.cid) it.copy(id = event.id, t = event.t, pending = false) else it
                })
            }

            is RippleEvent.Presence -> _state.update { it.copy(members = event.members, open = event.open) }

            is RippleEvent.Notice -> _state.update { it.copy(notice = event.text) }

            RippleEvent.Cleared -> _state.update { it.copy(messages = it.messages.filter { m -> m.pending }) }

            is RippleEvent.Terminal -> _state.update { it.copy(state = ConnState.Closed, terminal = event.reason) }
        }
    }

    private fun stableDid(ctx: Context): String {
        val p = ctx.getSharedPreferences("ripple", Context.MODE_PRIVATE)
        p.getString("did", null)?.let { return it }
        val bytes = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val d = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        p.edit().putString("did", d).apply()
        return d
    }
}
