package expo.modules.autosaarthicar

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * One screen on the car, drawn from whatever the [CarBridge] holds for its slot.
 *
 * It owns no content: when the JavaScript sends new content the bridge asks the screen to draw
 * again, and when the screen is asked for a template it reads the latest. Until the JavaScript has
 * sent anything it shows a spinner, never a guess.
 */
class ModelScreen(
    carContext: CarContext,
    /** The screen's id, or [CarBridge.ROOT_SLOT] for the first one. */
    val slot: String,
    private val bridge: CarBridge = CarBridge.shared,
) : Screen(carContext) {

    private var limits: Limits? = null
    private var drawn: CarScreenModel? = null
    private val redraw = Runnable { invalidate() }

    /**
     * How many templates this screen has put against the host's quota of five: its first, and each
     * later one that was not a refresh. The bridge keeps this at one by replacing the screen rather
     * than changing it in a way the host would count; tests hold it to that.
     */
    internal var steps = 0
        private set

    /** What this screen last drew (for tests): the model, which is not always the latest one it was sent. */
    internal val lastDrawn: CarScreenModel? get() = drawn

    init {
        // `popTo` finds a screen by its marker.
        marker = slot
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) = bridge.stackChanged()

            // A screen that is not showing is not drawn again; it reads the latest when it returns.
            override fun onStart(owner: LifecycleOwner) = bridge.subscribe(slot, redraw)
            override fun onStop(owner: LifecycleOwner) = bridge.unsubscribe(slot, redraw)

            override fun onDestroy(owner: LifecycleOwner) {
                bridge.unsubscribe(slot, redraw)
                bridge.stackChanged()
            }
        })
    }

    override fun onGetTemplate(): Template {
        val wanted = bridge.modelFor(slot) ?: CarBridge.LOADING
        val before = drawn
        // A screen that is returned to must answer with the same kind of template it last sent: any other
        // is an error that closes the app. A change of kind is made by replacing the screen, so until that
        // happens draw what was drawn before, and ask for the replacement.
        val model = if (before != null && before.kind != wanted.kind) {
            bridge.replaceLater(this)
            before
        } else {
            wanted
        }
        if (before == null || !Refresh.isRefresh(before, model)) steps += 1
        drawn = model
        bridge.rendered(slot, model)

        return try {
            TemplateBuilder.build(model, limits(), bridge::onAction)
        } catch (e: RuntimeException) {
            // The library refuses a template that breaks its rules. A car app that throws here is closed
            // by the host, so say so on the screen instead — and in the log, for whoever sent it.
            Log.e("AutoSaarthiCar", "screen '${model.id}' could not be drawn", e)
            TemplateBuilder.build(CarBridge.UNDRAWABLE, limits(), bridge::onAction)
        }
    }

    /** What this car's host will show. It varies by car; a host that will not say gets a safe default. */
    private fun limits(): Limits = limits ?: try {
        val manager = carContext.getCarService(ConstraintManager::class.java)
        Limits(
            list = manager.getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST).coerceAtLeast(1),
            pane = manager.getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PANE).coerceAtLeast(1),
        )
    } catch (e: Exception) {
        Limits()
    }.also { limits = it }
}
