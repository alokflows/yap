package com.ripple.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The one Ripple identity — warm clay on paper. Mirrors web + desktop.
val Clay = Color(0xFFC4673F)
val ClayLight = Color(0xFFE08A63)
val Paper = Color(0xFFFAF3ED)
val Ink = Color(0xFF2B2018)

private val LightColors = lightColorScheme(
    primary = Clay,
    onPrimary = Color.White,
    secondary = Color(0xFF9C5638),
    onSecondary = Color.White,
    background = Paper,
    onBackground = Ink,
    surface = Color(0xFFFFFDFB),
    onSurface = Ink,
    surfaceVariant = Color(0xFFEDE1D6),   // received bubbles
    onSurfaceVariant = Color(0xFF4A3B30),
    outline = Color(0xFFCDBBAC),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = ClayLight,
    onPrimary = Color(0xFF3A1B0D),
    secondary = Color(0xFFD79B7C),
    onSecondary = Color(0xFF3A1B0D),
    background = Color(0xFF1A1512),
    onBackground = Color(0xFFF2E7DD),
    surface = Color(0xFF221C18),
    onSurface = Color(0xFFF2E7DD),
    surfaceVariant = Color(0xFF3A312A),
    onSurfaceVariant = Color(0xFFD8C8BB),
    outline = Color(0xFF6B5C4F),
    error = Color(0xFFF2B8B5),
)

@Composable
fun RippleTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
