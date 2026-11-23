package expo.modules.autosaarthicar

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * One connection to a car. Opening it tells the app's JavaScript a car is there, and the first
 * screen is a spinner until the JavaScript answers; closing it tells the JavaScript to stop asking
 * the server about the car.
 */
class AutoSaarthiCarSession(private val bridge: CarBridge = CarBridge.shared) : Session() {

    override fun onCreateScreen(intent: Intent): Screen {
        val context = carContext
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) = bridge.sessionEnded(context)
        })
        bridge.sessionStarted(context)
        return ModelScreen(context, CarBridge.ROOT_SLOT, bridge)
    }
}
