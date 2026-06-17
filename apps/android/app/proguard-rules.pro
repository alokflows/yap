# OkHttp pulls in optional Conscrypt/BouncyCastle hooks behind try/catch; silence
# the resulting "missing class" warnings. (Release isn't minified yet anyway.)
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
