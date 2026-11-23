package expo.modules.autosaarthicar

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import com.facebook.react.ReactApplication

private const val TAG = "AutoSaarthiCar"

/** Runs things on the car's main thread, now or later. Replaced in tests, so a clock is not needed. */
interface Scheduler {
    fun post(task: Runnable)
    fun postDelayed(task: Runnable, delayMs: Long)
    fun cancel(task: Runnable)
}

class MainScheduler : Scheduler {
    private val handler = Handler(Looper.getMainLooper())
    override fun post(task: Runnable) { handler.post(task) }
    override fun postDelayed(task: Runnable, delayMs: Long) { handler.postDelayed(task, delayMs) }
    override fun cancel(task: Runnable) { handler.removeCallbacks(task) }
}

/** Brings the app's JavaScript up when the car connects and the app is not already open. */
fun interface RuntimeStarter {
    fun start(context: Context)
}

/**
 * Android Auto can bind to the app while the phone is in a pocket and the app was never opened, so
 * there may be no JavaScript running to answer. Starting the React host is what runs the bundle's
 * entry file (index.ts), which attaches the car controller; the same call is a no-op when the app
 * is already open.
 */
object ReactRuntimeStarter : RuntimeStarter {
    override fun start(context: Context) {
        val host = (context.applicationContext as? ReactApplication)?.reactHost ?: return
        if (host.currentReactContext == null) host.start()
    }
}

/** Where events for the JavaScript go: the Expo module, once its JavaScript has loaded. */
fun interface Sink {
    fun send(event: String, body: Map<String, Any?>)
}

/**
 * The seam between the car and the app's JavaScript.
 *
 * The JavaScript owns the session, the data and the words; it sends whole screens in
 * ([root], [push], [update], [pop]). The car's screens read them from here and tell the JavaScript
 * what was tapped. Events going the other way are `onConnected`, `onDisconnected`, `onAction`
 * ({screen, action}) and `onStack` ({ids}) — the screens now open, so the JavaScript never has to
 * guess what a back press did.
 *
 * **The template quota.** The car's host allows five templates in a task and closes the app when a
 * sixth is sent. A change that [Refresh] calls a refresh is drawn in place and costs nothing; any
 * other change — a card where a message was, a different title, a row more or fewer — is made by
 * putting a *new screen* in place of the old one, whose count starts again. However often the car
 * parks, moves or changes its readings, each screen has put at most one template against the quota.
 *
 * Nothing is kept past a connection: the next time the car connects the screens start empty and the
 * JavaScript sends them again, so a car never shows what an earlier drive's session saw.
 */
class CarBridge(
    private val scheduler: Scheduler,
    private val runtime: RuntimeStarter,
    private val bootTimeoutMs: Long = BOOT_TIMEOUT_MS,
) {
    companion object {
        /** The root screen's own slot: its content can change id (a message, then a card) without the stack changing. */
        const val ROOT_SLOT = "@root"
        const val BOOT_ID = "boot"
        const val BOOT_TIMEOUT_MS = 15_000L

        val shared: CarBridge by lazy { CarBridge(MainScheduler(), ReactRuntimeStarter) }

        /**
         * A loading *pane*, so that the first real screen — also a pane — arrives as a refresh: the host
         * counts a pane that follows a loading pane as free.
         */
        val LOADING = CarScreenModel(id = "loading", kind = CarKind.PANE, title = "AutoSaarthi", loading = true)

        /** What the car shows if a screen it was given cannot be drawn: one sentence, so the car app stays open. */
        val UNDRAWABLE = CarScreenModel(
            id = "undrawable", kind = CarKind.MESSAGE, title = "AutoSaarthi",
            message = "This screen could not be shown. Open AutoSaarthi on your phone.",
        )

        /** What the car shows when the app's JavaScript never answered, and how it is asked again. */
        private val NO_ANSWER = CarScreenModel(
            id = BOOT_ID, kind = CarKind.MESSAGE, title = "AutoSaarthi",
            message = "AutoSaarthi could not start. Open the app on your phone, then try again.",
            actions = listOf(CarAction(id = "retry", title = "Try again", primary = true)),
        )
    }

    private val lock = Any()
    private val models = HashMap<String, CarScreenModel>()
    /** What each slot last drew — what the host has seen, which is what a refresh is a refresh of. */
    private val shown = HashMap<String, CarScreenModel>()
    private val screens = HashMap<String, MutableSet<Runnable>>()
    private var rootId: String? = null
    private var sink: Sink? = null
    private var carContext: CarContext? = null
    private var connected = false
    private var bootTimer: Runnable? = null

    fun isConnected(): Boolean = synchronized(lock) { connected }

    // ── the app's JavaScript ─────────────────────────────────────────────────────────────────────

    /** The module's JavaScript is up. If a car is already connected it has to hear so. */
    fun attach(newSink: Sink) {
        val tell = synchronized(lock) { sink = newSink; connected }
        if (tell) emit("onConnected", emptyMap())
    }

    /**
     * The module's JavaScript is going. Only the sink that is attached right now may detach itself: when
     * the JavaScript reloads, the new module can attach before the old one is torn down, and that must
     * not leave the car with nobody to tell.
     */
    fun detach(old: Sink) = synchronized(lock) { if (sink === old) sink = null }

    private fun emit(event: String, body: Map<String, Any?>) {
        val target = synchronized(lock) { sink } ?: return
        try {
            target.send(event, body)
        } catch (e: Exception) {
            Log.w(TAG, "could not deliver $event", e)
        }
    }

    // ── the car ──────────────────────────────────────────────────────────────────────────────────

    fun sessionStarted(context: CarContext) {
        synchronized(lock) {
            carContext = context
            connected = true
            models.clear()
            shown.clear()
            rootId = null
        }
        emit("onConnected", emptyMap())
        startBoot(context)
    }

    fun sessionEnded(context: CarContext) {
        val ended = synchronized(lock) {
            if (carContext !== context) return@synchronized false
            carContext = null
            connected = false
            models.clear()
            shown.clear()
            rootId = null
            screens.clear()
            true
        }
        if (!ended) return
        cancelBoot()
        emit("onDisconnected", emptyMap())
    }

    /**
     * Asks for the app's JavaScript and waits for its first screen. Without one in time the car says
     * so — with a way to try again — instead of showing a spinner for ever.
     */
    private fun startBoot(context: Context) {
        scheduler.post {
            try {
                runtime.start(context)
            } catch (e: Exception) {
                Log.e(TAG, "could not start the app's JavaScript", e)
            }
        }
        val timer = Runnable { bootTimedOut() }
        synchronized(lock) {
            bootTimer?.let { scheduler.cancel(it) }
            bootTimer = timer
        }
        scheduler.postDelayed(timer, bootTimeoutMs)
    }

    private fun cancelBoot() {
        synchronized(lock) {
            bootTimer?.let { scheduler.cancel(it) }
            bootTimer = null
        }
    }

    private fun bootTimedOut() {
        val show = synchronized(lock) {
            if (!connected || rootId != null) return@synchronized false
            models[NO_ANSWER.id] = NO_ANSWER
            rootId = NO_ANSWER.id
            true
        }
        if (show) showRoot()
    }

    // ── what the screens read ────────────────────────────────────────────────────────────────────

    fun modelFor(slot: String): CarScreenModel? = synchronized(lock) {
        if (slot == ROOT_SLOT) rootId?.let { models[it] } else models[slot]
    }

    /** A screen drew this. It is what the host has now seen, and what the next change is compared with. */
    fun rendered(slot: String, model: CarScreenModel) {
        synchronized(lock) { shown[slot] = model }
    }

    fun subscribe(slot: String, invalidate: Runnable) {
        synchronized(lock) { screens.getOrPut(slot) { mutableSetOf() }.add(invalidate) }
    }

    fun unsubscribe(slot: String, invalidate: Runnable) {
        synchronized(lock) { screens[slot]?.remove(invalidate) }
    }

    private fun notify(slot: String) {
        val targets = synchronized(lock) { screens[slot]?.toList() } ?: return
        targets.forEach { it.run() }
    }

    private fun slotFor(id: String): String = synchronized(lock) { if (id == rootId) ROOT_SLOT else id }

    private fun screenManager(): ScreenManager? =
        synchronized(lock) { carContext }?.getCarService(ScreenManager::class.java)

    private fun screenFor(slot: String): ModelScreen? =
        screenManager()?.screenStack?.firstOrNull { (it as? ModelScreen)?.slot == slot } as? ModelScreen

    /** A tap. The boot screen's retry is answered here; everything else is the JavaScript's to decide. */
    fun onAction(screen: String, action: String) {
        if (screen == BOOT_ID && action == "retry") {
            synchronized(lock) {
                models.remove(BOOT_ID)
                rootId = null
            }
            showRoot()
            synchronized(lock) { carContext }?.let { startBoot(it) }
            return
        }
        emit("onAction", mapOf("screen" to screen, "action" to action))
    }

    /** A screen came or went; tell the JavaScript what is open now. */
    fun stackChanged() {
        scheduler.post {
            val manager = screenManager() ?: return@post
            // The library lists the top screen first; the app wants the first screen first.
            val ids = manager.screenStack.reversed().mapNotNull { screen ->
                (screen as? ModelScreen)?.let { synchronized(lock) { if (it.slot == ROOT_SLOT) rootId else it.slot } }
            }
            emit("onStack", mapOf("ids" to ids))
        }
    }

    // ── drawing a change: in place if the host calls it a refresh, otherwise on a new screen ─────

    /** The slot's model has changed: redraw it where it is, or — if the host would count it — replace the screen. */
    private fun applyChange(slot: String) {
        val next = modelFor(slot) ?: return
        val previous = synchronized(lock) { shown[slot] }
        if (Refresh.isRefresh(previous, next)) {
            notify(slot)
            return
        }
        val old = screenFor(slot) ?: return
        // Only the screen the driver is looking at is replaced. A screen underneath draws the latest when it
        // comes back, and asks to be replaced then if the kind of template changed (ModelScreen).
        if (screenManager()?.top === old) replaceTop(old)
    }

    /** A new screen for the same slot goes on top and the old one goes: the same place, a count that starts again. */
    private fun replaceTop(old: ModelScreen) {
        val context = synchronized(lock) { carContext } ?: return
        val manager = context.getCarService(ScreenManager::class.java)
        manager.push(ModelScreen(context, old.slot, this))
        manager.remove(old)
    }

    /**
     * A screen that came back with a different kind of template to show asks for itself to be replaced.
     * If it is no longer the screen on top by the time this runs — it was already replaced, or something
     * was opened over it — there is nothing to do.
     */
    fun replaceLater(screen: ModelScreen) {
        scheduler.post {
            if (screenManager()?.top === screen) replaceTop(screen)
        }
    }

    /** The first screen, drawn in place if it is only a refresh of what is there, otherwise on a fresh stack. */
    private fun showRoot() {
        val manager = screenManager() ?: return
        val next = modelFor(ROOT_SLOT) ?: LOADING
        val previous = synchronized(lock) { shown[ROOT_SLOT] }
        if (manager.stackSize == 1 && Refresh.isRefresh(previous, next)) {
            notify(ROOT_SLOT)
            return
        }
        val context = synchronized(lock) { carContext } ?: return
        val open = manager.screenStack.toList()
        manager.push(ModelScreen(context, ROOT_SLOT, this))
        open.forEach { manager.remove(it) }
        // The screens that are gone take what they last drew with them; the root's stays, as it is what is on show.
        synchronized(lock) { shown.keys.retainAll(setOf(ROOT_SLOT)) }
    }

    // ── what the JavaScript sends ────────────────────────────────────────────────────────────────

    /** The first screen, replacing whatever is open. False when no car is connected. */
    fun root(model: CarScreenModel): Boolean {
        synchronized(lock) {
            if (!connected) return false
            models.clear()
            models[model.id] = model
            rootId = model.id
        }
        cancelBoot()
        scheduler.post { showRoot() }
        return true
    }

    /** New content for a screen that is open. Nothing is drawn again if it is the same. */
    fun update(model: CarScreenModel): Boolean {
        val slot = synchronized(lock) {
            if (!connected || !models.containsKey(model.id)) return false
            if (models[model.id] == model) return true
            models[model.id] = model
            slotFor(model.id)
        }
        scheduler.post { applyChange(slot) }
        return true
    }

    /** A screen on top of the one open. Pushing the one already on top changes it instead. */
    fun push(model: CarScreenModel): Boolean {
        synchronized(lock) {
            if (!connected) return false
            models[model.id] = model
        }
        scheduler.post {
            val context = synchronized(lock) { carContext } ?: return@post
            val manager = context.getCarService(ScreenManager::class.java)
            val top = manager.top
            if (top is ModelScreen && top.slot == slotFor(model.id)) applyChange(top.slot) else manager.push(ModelScreen(context, model.id, this))
        }
        return true
    }

    /** Back one screen, or back to the screen with this id. */
    fun pop(toId: String?): Boolean {
        if (!isConnected()) return false
        scheduler.post {
            val manager = screenManager() ?: return@post
            if (toId == null) {
                if (manager.stackSize > 1) manager.pop()
                return@post
            }
            val slot = slotFor(toId)
            if (slot == ROOT_SLOT) {
                if (manager.stackSize > 1) manager.popToRoot()
            } else if (manager.screenStack.any { it.marker == slot }) {
                manager.popTo(slot)
            }
        }
        return true
    }
}
