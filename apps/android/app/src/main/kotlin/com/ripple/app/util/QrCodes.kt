package com.ripple.app.util

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.net.URLEncoder

/**
 * QR generation for pairing — byte-compatible with the web/desktop QR, which
 * encodes the auto-connect link `https://…/?room=<CODE>` (raw code; the relay
 * never sees it — clients hash it). Scanning that link on any Ripple client (or
 * a phone camera that opens the web app) joins the same room. Pure-Java + offline.
 */
object QrCodes {
    const val RELAY_WEB = "https://yap-mkk4.onrender.com"

    fun linkFor(code: String): String = "$RELAY_WEB/?room=" + URLEncoder.encode(code, "UTF-8")

    fun encode(text: String, size: Int): Bitmap {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 1,
        )
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bmp.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
            }
        }
        return bmp
    }

    /** Convenience: the pairing QR for a code at the given pixel size. */
    fun pairing(code: String, size: Int): Bitmap = encode(linkFor(code), size)
}
