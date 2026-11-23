package expo.modules.autosaarthicar

import androidx.car.app.OnDoneCallback
import androidx.car.app.model.OnClickDelegate
import androidx.car.app.serialization.Bundleable

/** Presses a button or row the way the car's host does, and fails the test if the app refused it. */
internal fun OnClickDelegate.tap() {
    var failure: Bundleable? = null
    sendClick(object : OnDoneCallback {
        override fun onSuccess(response: Bundleable?) = Unit
        override fun onFailure(response: Bundleable) { failure = response }
    })
    check(failure == null) { "the tap was refused" }
}
