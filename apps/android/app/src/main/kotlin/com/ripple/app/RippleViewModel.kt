package com.ripple.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
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

/** Snapshot the Compose tree renders. Immutable so recomposition is cheap + correct. */
data class UiState(
    val screen: Screen = Screen.Connect,
    val code: String = "",
    val state: ConnState = ConnState.Idle,
    val messages: List<ChatMessage> = emptyList(),
    val members: List<Member> = emptyList(),
    val open: Boolean = true,
    val notice: String? = null,
    val terminal: String? = null,
)

enum class Screen { Connect, Chat }

class RippleViewModel(app: Application) : AndroidViewModel(app) {

    private val did: String = stableDid(app)

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var client: RippleClient? = null

    fun connect(code: String) {
        val normalized = code.trim()
        if (normalized.isEmpty()) return
        client?.disconnect()
        val c = RippleClient(did = did, onEvent = ::onEvent)
        client = c
        _ui.update { it.copy(screen = Screen.Chat, code = normalized, messages = emptyList(), terminal = null, notice = null) }
        c.connect(normalized)
    }

    fun send(text: String) {
        val pending = client?.send(text) ?: return
        _ui.update { it.copy(messages = it.messages + pending) }
    }

    fun leave() {
        client?.disconnect()
        client = null
        _ui.update { UiState() }   // back to a clean Connect screen
    }

    fun dismissNotice() = _ui.update { it.copy(notice = null) }

    override fun onCleared() {
        client?.disconnect()
        super.onCleared()
    }

    private fun onEvent(event: RippleEvent) {
        when (event) {
            is RippleEvent.Status -> _ui.update { it.copy(state = event.state) }

            is RippleEvent.Incoming -> _ui.update { it.copy(messages = it.messages + event.message) }

            is RippleEvent.History -> _ui.update { state ->
                // Keep any optimistic/pending bubbles we already painted, drop the rest.
                val mineKept = state.messages.filter { it.mine }
                state.copy(messages = (event.messages + mineKept).sortedBy { it.t })
            }

            is RippleEvent.Acked -> _ui.update { state ->
                val updated = state.messages.map {
                    if (it.pending && it.cid == event.cid) it.copy(id = event.id, t = event.t, pending = false) else it
                }
                state.copy(messages = updated)
            }

            is RippleEvent.Presence -> _ui.update {
                it.copy(members = event.members, open = event.open)
            }

            is RippleEvent.Notice -> _ui.update { it.copy(notice = event.text) }

            RippleEvent.Cleared -> _ui.update { it.copy(messages = it.messages.filter { m -> m.pending }) }

            is RippleEvent.Terminal -> _ui.update {
                it.copy(state = ConnState.Closed, terminal = event.reason)
            }
        }
    }

    companion object {
        /** A per-install device id (host model + locked rooms key on it). Persisted. */
        private fun stableDid(ctx: Context): String {
            val prefs = ctx.getSharedPreferences("ripple", Context.MODE_PRIVATE)
            prefs.getString("did", null)?.let { return it }
            val bytes = ByteArray(12).also { SecureRandom().nextBytes(it) }
            val did = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            prefs.edit().putString("did", did).apply()
            return did
        }
    }
}
