package com.ripple.app.ime

import android.content.Intent
import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.ripple.app.MainActivity
import com.ripple.app.RippleRepository
import com.ripple.app.RippleState
import com.ripple.app.net.ChatMessage
import com.ripple.app.net.ConnState
import com.ripple.app.util.QrCodes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * The Ripple keyboard. A working compact keyboard plus the Ripple panel: received
 * text from paired devices shows as chips that **insert at the cursor** on tap,
 * and what you type here can be **sent to your other devices** with one key. It
 * shares the one socket via [RippleRepository], so pairing in the app lights this
 * up instantly. (A FlorisBoard-grade layout/emoji/glide engine can replace the
 * key grid later; the panel + plumbing stay the same.)
 */
class RippleImeService : InputMethodService() {

    // Clay-on-paper identity, mirrored from the app theme.
    private val clay = Color.parseColor("#C4673F")
    private val paper = Color.parseColor("#FAF3ED")
    private val received = Color.parseColor("#EDE1D6")
    private val ink = Color.parseColor("#2B2018")
    private val key = Color.parseColor("#FFFDFB")

    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    // What the user has typed on THIS keyboard since the last send (best-effort).
    private val composeBuffer = StringBuilder()
    private var shifted = false

    private var statusView: TextView? = null
    private var chipsRow: LinearLayout? = null
    private var chipsScroll: View? = null
    private var qrView: ImageView? = null
    private var qrShown = false
    private val letterKeys = ArrayList<Button>()

    override fun onCreate() {
        super.onCreate()
        RippleRepository.init(applicationContext)
        scope.launch {
            RippleRepository.state.collectLatest { render(it) }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(paper)
            setPadding(dp(4), dp(4), dp(4), dp(6))
        }

        root.addView(buildPanel())
        root.addView(buildKeyboard())

        render(RippleRepository.state.value)
        return root
    }

    override fun onStartInputView(info: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        composeBuffer.setLength(0)
        qrShown = false
        qrView?.visibility = View.GONE
        chipsScroll?.visibility = View.VISIBLE
        render(RippleRepository.state.value)
    }

    // ---- Panel (status + received chips) ---------------------------------------

    private fun buildPanel(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        statusView = TextView(this).apply {
            setTextColor(ink)
            textSize = 13f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
            setOnClickListener { openApp() }
        }
        bar.addView(statusView)
        bar.addView(pill("QR") { toggleQr() })
        bar.addView(pill("App") { openApp() })
        column.addView(bar)

        val scroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        }
        chipsScroll = scroll
        chipsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(2), dp(4), dp(6))
        }
        scroll.addView(chipsRow)
        column.addView(scroll)

        // Pairing QR — hidden until the user taps "QR"; same /?room=CODE link as web.
        qrView = ImageView(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.WHITE)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            layoutParams = LinearLayout.LayoutParams(dp(180), dp(180)).also {
                it.gravity = Gravity.CENTER_HORIZONTAL
                it.bottomMargin = dp(6)
            }
        }
        column.addView(qrView)
        return column
    }

    private fun toggleQr() {
        val code = RippleRepository.currentCode
        if (code.isEmpty()) { toast("Pair first — tap App to enter a code"); openApp(); return }
        qrShown = !qrShown
        if (qrShown) {
            qrView?.setImageBitmap(QrCodes.pairing(code, dp(176)))
            qrView?.visibility = View.VISIBLE
            chipsScroll?.visibility = View.GONE
        } else {
            qrView?.visibility = View.GONE
            chipsScroll?.visibility = View.VISIBLE
        }
    }

    private fun render(state: RippleState) {
        statusView?.text = statusLine(state)
        if (state.code.isEmpty() && qrShown) {
            qrShown = false
            qrView?.visibility = View.GONE
            chipsScroll?.visibility = View.VISIBLE
        }
        val row = chipsRow ?: return
        row.removeAllViews()
        val incoming = state.messages.filter { !it.mine }.takeLast(8)
        if (incoming.isEmpty()) {
            row.addView(TextView(this).apply {
                text = "Received text appears here — tap to insert at the cursor"
                setTextColor(Color.parseColor("#8A7866"))
                textSize = 12f
                setPadding(dp(6), dp(6), dp(6), dp(6))
            })
            return
        }
        for (m in incoming) row.addView(chip(m))
    }

    private fun chip(m: ChatMessage): View = Button(this).apply {
        text = m.text.let { if (it.length > 28) it.take(27) + "…" else it }
        setAllCaps(false)
        setTextColor(ink)
        setBackgroundColor(received)
        textSize = 14f
        setPadding(dp(12), dp(6), dp(12), dp(6))
        val lp = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT)
        lp.rightMargin = dp(6)
        layoutParams = lp
        setOnClickListener { insert(m.text) }
    }

    // ---- Keyboard --------------------------------------------------------------

    private val rows = listOf("1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm")

    private fun buildKeyboard(): View {
        val pad = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        }
        letterKeys.clear()
        for ((index, r) in rows.withIndex()) {
            val row = newRow()
            // The last letter row gets Shift on the left and Backspace on the right.
            if (index == rows.lastIndex) row.addView(funcKey("⇧", 1.5f) { toggleShift() })
            for (ch in r) row.addView(letterKey(ch))
            if (index == rows.lastIndex) row.addView(funcKey("⌫", 1.5f) { backspace() })
            pad.addView(row)
        }
        val bottom = newRow()
        bottom.addView(funcKey("Ripple ⤴", 2f, accent = true) { sendBuffer() })
        bottom.addView(funcKey("space", 4f) { type(" ") })
        bottom.addView(funcKey("↵", 1.5f) { enter() })
        pad.addView(bottom)
        return pad
    }

    private fun newRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    }

    private fun letterKey(ch: Char): Button = baseKey().apply {
        text = ch.toString()
        layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f).also { it.setMargins(dp(2), dp(2), dp(2), dp(2)) }
        setOnClickListener {
            type(if (shifted) ch.uppercaseChar().toString() else ch.toString())
            if (shifted) toggleShift()   // caps-once
        }
        letterKeys.add(this)
    }

    private fun funcKey(label: String, weight: Float, accent: Boolean = false, onClick: () -> Unit): Button =
        baseKey().apply {
            text = label
            if (accent) { setBackgroundColor(clay); setTextColor(Color.WHITE) }
            layoutParams = LinearLayout.LayoutParams(0, dp(46), weight).also { it.setMargins(dp(2), dp(2), dp(2), dp(2)) }
            setOnClickListener { onClick() }
        }

    private fun baseKey(): Button = Button(this).apply {
        setAllCaps(false)
        setBackgroundColor(key)
        setTextColor(ink)
        textSize = 16f
        setPadding(0, 0, 0, 0)
        minWidth = 0
        minHeight = 0
    }

    private fun pill(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        setAllCaps(false)
        setBackgroundColor(clay)
        setTextColor(Color.WHITE)
        textSize = 12f
        setPadding(dp(12), dp(4), dp(12), dp(4))
        setOnClickListener { onClick() }
    }

    private fun toggleShift() {
        shifted = !shifted
        for (b in letterKeys) {
            val c = b.text.firstOrNull() ?: continue
            b.text = (if (shifted) c.uppercaseChar() else c.lowercaseChar()).toString()
        }
    }

    // ---- Editing actions -------------------------------------------------------

    private fun type(text: String) {
        currentInputConnection?.commitText(text, 1)
        composeBuffer.append(text)
    }

    private fun backspace() {
        currentInputConnection?.deleteSurroundingText(1, 0)
        if (composeBuffer.isNotEmpty()) composeBuffer.deleteCharAt(composeBuffer.length - 1)
    }

    private fun enter() {
        // Use the field's own action (Search/Send/Go) when it has one; else newline.
        if (!sendDefaultEditorAction(true)) currentInputConnection?.commitText("\n", 1)
    }

    /** Insert received text at the cursor (the headline feature). */
    private fun insert(text: String) {
        currentInputConnection?.commitText(text, 1)
    }

    /** Broadcast what was typed here to the paired devices. */
    private fun sendBuffer() {
        val text = composeBuffer.toString().trim()
        if (text.isEmpty()) { toast("Type something, then tap Ripple to send it"); return }
        if (!RippleRepository.isConnected) { toast("Not paired — open the Ripple app"); openApp(); return }
        RippleRepository.send(text)
        composeBuffer.setLength(0)
        toast("Sent to your devices")
    }

    private fun openApp() {
        startActivity(
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun statusLine(s: RippleState): String = when {
        s.code.isEmpty() -> "Ripple — not paired · tap to open the app"
        s.state == ConnState.Connected -> {
            val others = (s.members.size - 1).coerceAtLeast(0)
            "Ripple · ${s.code} · ${if (others > 0) "$others device${if (others == 1) "" else "s"}" else "waiting"}"
        }
        s.state == ConnState.Connecting || s.state == ConnState.Reconnecting -> "Ripple · ${s.code} · connecting…"
        else -> "Ripple · ${s.code} · offline"
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
