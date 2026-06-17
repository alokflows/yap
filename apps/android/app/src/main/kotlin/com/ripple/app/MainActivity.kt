package com.ripple.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.ripple.app.ui.RippleApp

/**
 * The container app: a website-identical pairing + chat screen (and, later, the
 * keyboard setup wizard and settings). The IME itself lands in a follow-up pass.
 */
class MainActivity : ComponentActivity() {
    private val vm: RippleViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { RippleApp(vm) }
    }
}
