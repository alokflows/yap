package com.ripple.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ripple.app.net.ChatMessage
import com.ripple.app.net.ConnState
import com.ripple.app.net.Member
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

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

enum class Screen { Connect, Scan, Chat }

/**
 * Thin adapter over [RippleRepository] (which owns the one shared socket). The
 * ViewModel only adds the app's local navigation state (Connect vs Chat); all
 * connection state is the repository's, so the keyboard sees the same thing.
 */
class RippleViewModel(app: Application) : AndroidViewModel(app) {

    init {
        RippleRepository.init(app)
        // Re-pair with the remembered code so the app opens straight into chat
        // instead of asking for a code every launch.
        RippleRepository.resume()
    }

    private val screen = MutableStateFlow(
        if (RippleRepository.isConnected || RippleRepository.savedCode != null) Screen.Chat else Screen.Connect
    )

    val ui: StateFlow<UiState> = combine(screen, RippleRepository.state) { scr, s ->
        UiState(
            screen = scr,
            code = s.code,
            state = s.state,
            messages = s.messages,
            members = s.members,
            open = s.open,
            notice = s.notice,
            terminal = s.terminal,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, UiState())

    fun connect(code: String) {
        if (code.isBlank()) return
        screen.value = Screen.Chat
        RippleRepository.connect(code)
    }

    fun openScanner() { screen.value = Screen.Scan }

    fun cancelScan() { screen.value = Screen.Connect }

    fun send(text: String) { RippleRepository.send(text) }

    fun leave() {
        screen.value = Screen.Connect
        RippleRepository.leave()
    }

    fun dismissNotice() = RippleRepository.dismissNotice()
}
