package expo.modules.autosaarthicar

import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * The door Android Auto knocks on (declared in this module's AndroidManifest.xml, category IOT).
 * The host binds to it when a phone connects to a car; everything after that is the session.
 */
class AutoSaarthiCarService : CarAppService() {

    /**
     * Only Google's car hosts may connect in a release build. A debug build accepts any, which is
     * what lets the Desktop Head Unit and the car-app test tools reach it during development.
     */
    override fun createHostValidator(): HostValidator =
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = AutoSaarthiCarSession()
}
