package py.aguateria.field.data.session

import android.content.SharedPreferences

class SessionStore(private val prefs: SharedPreferences) {
    var accessToken: String?
        get() = prefs.getString("access", null)
        set(value) { prefs.edit().putString("access", value).apply() }

    var refreshToken: String?
        get() = prefs.getString("refresh", null)
        set(value) { prefs.edit().putString("refresh", value).apply() }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
