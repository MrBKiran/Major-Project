package expo.modules.autosaarthicar

import android.content.Context
import android.content.Intent
import androidx.car.app.ScreenManager
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Template
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.SessionController
import androidx.car.app.testing.TestCarContext
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The whole path from a car connecting to a screen on it, with the Car App Library's own test host
 * standing in for Android Auto and a fake clock instead of a real one.
 */
@RunWith(RobolectricTestRunner::class)
class CarBridgeTest {

    private class FakeScheduler : Scheduler {
        val delayed = mutableListOf<Pair<Runnable, Long>>()
        override fun post(task: Runnable) = task.run()
        override fun postDelayed(task: Runnable, delayMs: Long) { delayed += task to delayMs }
        override fun cancel(task: Runnable) { delayed.removeAll { it.first === task } }
        fun fireDelayed() {
            val due = delayed.toList()
            delayed.clear()
            due.forEach { it.first.run() }
        }
    }

    private val scheduler = FakeScheduler()
    private val events = mutableListOf<Pair<String, Map<String, Any?>>>()
    private val started = mutableListOf<Context>()
    private val bridge = CarBridge(scheduler, { started += it }, bootTimeoutMs = 5_000)
    private val carContext: TestCarContext = TestCarContext.createCarContext(ApplicationProvider.getApplicationContext())
    private var session: SessionController? = null

    private fun listen() = bridge.attach { event, body -> events += event to body }

    private fun manager(): ScreenManager = carContext.getCarService(ScreenManager::class.java)

    /** The screens open, first screen first. */
    private fun stack(): List<ModelScreen> = manager().screenStack.reversed().map { it as ModelScreen }

    private fun top(): ModelScreen = manager().top as ModelScreen

    private fun shown(): Template = top().onGetTemplate()

    /**
     * A real car host moves a screen through its lifecycle as it is pushed; the library's test host
     * leaves it where it was made. Doing it for the newest screen is all that is needed.
     */
    private fun settle() {
        ScreenController(top()).moveToState(Lifecycle.State.RESUMED)
    }

    private fun connect(): SessionController {
        val controller = SessionController(AutoSaarthiCarSession(bridge), carContext, Intent())
        controller.moveToState(Lifecycle.State.RESUMED)
        settle()
        session = controller
        return controller
    }

    /** What the app does to open a screen: send it, and let the car draw it. */
    private fun open(model: CarScreenModel) {
        assertTrue(bridge.push(model))
        settle()
    }

    private fun names(): List<String> = events.map { it.first }

    /** A card whose row title is steady and whose text can change — which the host calls a refresh. */
    private fun card(id: String = "status", title: String = "Bolero", line: String = "Everything reads normal") =
        CarScreenModel(id = id, kind = CarKind.PANE, title = title, rows = listOf(CarRow("Health", listOf(line))))

    /** The same car while it moves: one row, a different title. The host would count the change, so it is a new screen. */
    private fun moving(title: String = "Bolero") =
        CarScreenModel(id = "status", kind = CarKind.PANE, title = title, rows = listOf(CarRow("Water pump service needed within 5 days.")))

    private fun parkedWithCosts(title: String = "Bolero") =
        CarScreenModel(
            id = "status", kind = CarKind.PANE, title = title,
            rows = listOf(CarRow("Your water pump is wearing out"), CarRow("Repair now ₹2,400"), CarRow("Booked · Mon 23 Nov, 9:00 am")),
        )

    private fun times() = CarScreenModel(
        id = "slots", kind = CarKind.LIST, title = "Pick a time", back = true,
        rows = listOf(CarRow("Mon 23 Nov, 9:00 am", listOf("Pune Central"), action = "slot:0", parkedOnly = true)),
    )

    // ── connecting ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun aCarConnectingStartsTheAppAndShowsASpinnerUntilItAnswers() {
        listen()
        connect()
        assertTrue(bridge.isConnected())
        assertEquals(listOf("onConnected", "onStack"), names())
        assertEquals(1, started.size)
        val template = shown() as PaneTemplate
        assertEquals("AutoSaarthi", template.title.toString())
        assertTrue("a loading pane, so the first card follows it as a refresh", template.pane.isLoading)
    }

    @Test
    fun aJavaScriptThatLoadsAfterTheCarStillHearsAboutIt() {
        connect()
        listen()
        assertEquals(listOf("onConnected"), names())
    }

    @Test
    fun nothingIsAcceptedWithoutACar() {
        assertFalse(bridge.root(card()))
        assertFalse(bridge.push(card()))
        assertFalse(bridge.update(card()))
        assertFalse(bridge.pop(null))
    }

    // ── the first screen ─────────────────────────────────────────────────────────────────────────

    @Test
    fun theAnswerReplacesTheSpinner() {
        connect()
        assertTrue(bridge.root(card(title = "Bolero · MH12AB1001")))
        val template = shown() as PaneTemplate
        assertEquals("Bolero · MH12AB1001", template.title.toString())
        assertTrue("the wait for an answer is over", scheduler.delayed.isEmpty())
    }

    @Test
    fun noAnswerInTimeSaysSoAndOffersAnotherGo() {
        listen()
        connect()
        assertEquals(listOf(BOOT_WAIT), scheduler.delayed.map { it.second })
        scheduler.fireDelayed()

        val template = shown() as MessageTemplate
        assertTrue(template.message.toString().contains("could not start"))
        assertEquals(listOf("Try again"), template.actions.map { it.title.toString() })

        // Trying again asks for the app again, and the car goes back to waiting — nothing is sent to the app.
        events.clear()
        template.actions.single().onClickDelegate!!.tap()
        assertEquals(2, started.size)
        assertTrue((shown() as PaneTemplate).pane.isLoading)
        assertEquals(1, scheduler.delayed.size)
        assertFalse(names().contains("onAction"))
    }

    @Test
    fun anAnswerAfterTheTimeoutStillWins() {
        connect()
        scheduler.fireDelayed()
        assertTrue(bridge.root(card(title = "Late but here")))
        assertEquals("Late but here", (shown() as PaneTemplate).title.toString())
    }

    // ── changing what is shown ───────────────────────────────────────────────────────────────────

    @Test
    fun aScreenIsDrawnAgainOnlyWhenItsContentChanged() {
        connect()
        bridge.root(card())
        var redraws = 0
        bridge.subscribe(CarBridge.ROOT_SLOT) { redraws++ }

        assertTrue(bridge.update(card()))
        assertEquals("the same words are not drawn again", 0, redraws)

        assertTrue(bridge.update(card(line = "Your water pump is wearing out")))
        assertEquals(1, redraws)
        assertEquals(
            listOf("Your water pump is wearing out"),
            ((shown() as PaneTemplate).pane.rows.single() as androidx.car.app.model.Row).texts.map { it.toString() },
        )
    }

    @Test
    fun updatingAScreenThatIsNotOpenDoesNothing() {
        connect()
        bridge.root(card())
        assertFalse(bridge.update(times()))
        assertEquals(1, stack().size)
    }

    // ── going deeper and back ────────────────────────────────────────────────────────────────────

    @Test
    fun aPushedScreenStacksAndBackReturns() {
        listen()
        connect()
        bridge.root(card())
        events.clear()

        open(times())
        assertEquals(listOf(CarBridge.ROOT_SLOT, "slots"), stack().map { it.slot })
        assertTrue(shown() is ListTemplate)
        assertEquals(listOf("status", "slots"), events.last { it.first == "onStack" }.second["ids"])

        assertTrue(bridge.pop(null))
        assertEquals(1, stack().size)
        assertTrue(shown() is PaneTemplate)
        assertEquals(listOf("status"), events.last { it.first == "onStack" }.second["ids"])
    }

    @Test
    fun pushingTheScreenAlreadyOnTopUpdatesItInstead() {
        connect()
        bridge.root(card())
        open(times())
        open(times().copy(title = "Pick a time to book"))
        assertEquals(2, stack().size)
        assertEquals("Pick a time to book", (shown() as ListTemplate).title.toString())
    }

    @Test
    fun backCannotLeaveTheFirstScreen() {
        connect()
        bridge.root(card())
        bridge.pop(null)
        assertEquals(1, stack().size)
    }

    @Test
    fun popToTheFirstScreenClosesEverythingAbove() {
        connect()
        bridge.root(card())
        open(times())
        open(CarScreenModel(id = "result", kind = CarKind.MESSAGE, title = "Booked", message = "Done."))
        assertEquals(3, stack().size)
        bridge.pop("status")
        assertEquals(1, stack().size)
    }

    @Test
    fun popToAMiddleScreenKeepsItOpen() {
        connect()
        bridge.root(card())
        open(times())
        open(CarScreenModel(id = "result", kind = CarKind.MESSAGE, title = "Booked", message = "Done."))
        bridge.pop("slots")
        assertEquals(2, stack().size)
        assertTrue(shown() is ListTemplate)
    }

    @Test
    fun aNewFirstScreenClosesEverythingAbove() {
        connect()
        bridge.root(card())
        open(times())
        bridge.root(card(title = "Another car"))
        assertEquals(1, stack().size)
        assertEquals("Another car", (shown() as PaneTemplate).title.toString())
    }

    // ── taps ─────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun aTapIsPassedToTheAppWithTheScreenItWasOn() {
        listen()
        connect()
        bridge.root(card())
        open(times())
        events.clear()

        val row = (shown() as ListTemplate).singleList!!.items.single() as androidx.car.app.model.Row
        row.onClickDelegate!!.tap()
        assertEquals(listOf("onAction" to mapOf("screen" to "slots", "action" to "slot:0")), events.filter { it.first == "onAction" })
    }

    // ── the template quota ───────────────────────────────────────────────────────────────────────

    @Test
    fun theFirstCardFollowsTheSpinnerInPlace() {
        connect()
        val spinner = top()
        shown()
        assertTrue(bridge.root(card()))
        assertTrue(shown() is PaneTemplate)
        assertSame("a refresh: the same screen, nothing new for the host to count", spinner, top())
        assertEquals(1, top().steps)
    }

    @Test
    fun newWordsUnderTheSameTitlesAreDrawnInPlaceAndCostNothing() {
        connect()
        bridge.root(card())
        val screen = top()
        shown()
        repeat(10) { n ->
            bridge.update(card(line = "About ${10 - n} days of driving left"))
            shown()
        }
        assertSame(screen, top())
        assertEquals(1, screen.steps)
    }

    @Test
    fun aDifferentTitleOrRowCountIsANewScreenWhoseCountStartsAgain() {
        connect()
        bridge.root(card())
        val before = top()
        shown()

        assertTrue(bridge.update(moving()))
        settle()
        assertEquals("one screen open, as before", 1, stack().size)
        assertNotSame("replaced, not changed", before, top())
        assertEquals(1, (shown() as PaneTemplate).pane.rows.size)
        assertEquals(1, top().steps)
    }

    @Test
    fun aDifferentKindOfTemplateReplacesTheScreenToo() {
        connect()
        bridge.root(card())
        val before = top()
        shown()
        assertTrue(bridge.update(CarScreenModel(id = "status", kind = CarKind.MESSAGE, title = "AutoSaarthi", message = "No connection right now.")))
        settle()
        assertNotSame(before, top())
        assertTrue(shown() is MessageTemplate)
    }

    @Test
    fun aCarThatParksAndMovesAllDayStaysFarInsideTheQuotaOfFive() {
        connect()
        bridge.root(card())
        shown()
        // Every one of these changes is one the host would count; each replaces the screen, so none accumulates.
        repeat(40) { n ->
            assertTrue(bridge.update(if (n % 2 == 0) moving() else parkedWithCosts()))
            settle()
            shown()
        }
        assertEquals(1, stack().size)
        assertEquals("the host has been sent one template for the screen it is showing", 1, top().steps)
    }

    @Test
    fun theWholeBookingFlowFitsEvenWhenTheCardUnderneathHasChanged() {
        connect()
        bridge.root(parkedWithCosts())
        shown()
        open(times())
        shown()
        open(CarScreenModel(id = "booking", kind = CarKind.PANE, title = "Booking", loading = true))
        shown()
        // The result is a pane that follows a loading pane: a refresh, in place.
        val booking = top()
        assertTrue(
            bridge.update(
                CarScreenModel(
                    id = "booking", kind = CarKind.PANE, title = "Booking",
                    rows = listOf(CarRow("Booked", listOf("Mon 23 Nov, 9:00 am at Pune Central"))),
                    actions = listOf(CarAction("done", "Done", primary = true)),
                ),
            ),
        )
        shown()
        assertSame(booking, top())
        assertEquals(3, stack().size)
        assertEquals("every screen has put one template against the quota", 3, stack().sumOf { it.steps })
        assertTrue("well inside five", stack().sumOf { it.steps } <= 5)
    }

    @Test
    fun aScreenUnderneathIsLeftAloneWhileHiddenAndReplacedWhenItComesBackIfItsKindChanged() {
        connect()
        bridge.root(card())
        shown()
        open(times())
        shown()
        val root = stack().first()

        // The card becomes a message while the time picker is open.
        val message = CarScreenModel(id = "status", kind = CarKind.MESSAGE, title = "AutoSaarthi", message = "No connection right now.")
        assertTrue(bridge.update(message))
        assertSame("nothing was done to the screen underneath", root, stack().first())

        // Back to it. The host asks the returning screen for a template as it is revealed: it must be
        // answered with a card, as before, and the screen is then replaced by one that can show a message.
        bridge.pop(null)
        assertEquals("it answered with the kind of template it last sent", CarKind.PANE, root.lastDrawn?.kind)
        assertEquals(1, stack().size)
        assertNotSame("and was replaced", root, top())
        assertTrue(shown() is MessageTemplate)
    }

    // ── a screen the library refuses ─────────────────────────────────────────────────────────────

    @Test
    fun aScreenTheLibraryRefusesBecomesASentenceNotACrash() {
        connect()
        // Three buttons is one more than a pane may have; the JSON model would have dropped it, this one was built by hand.
        val tooMany = card().copy(actions = listOf(CarAction("a", "A"), CarAction("b", "B"), CarAction("c", "C")))
        assertTrue(bridge.root(tooMany))
        val template = shown() as MessageTemplate
        assertTrue(template.message.toString().contains("could not be shown"))
    }

    // ── the JavaScript reloading ─────────────────────────────────────────────────────────────────

    @Test
    fun anOldModuleGoingDoesNotDisconnectTheNewOne() {
        val received = mutableListOf<String>()
        val old = Sink { event, _ -> received += "old:$event" }
        val fresh = Sink { event, _ -> received += "new:$event" }
        bridge.attach(old)
        bridge.attach(fresh)   // the reloaded JavaScript attaches before the old one is torn down
        bridge.detach(old)
        connect()
        assertEquals(listOf("new:onConnected", "new:onStack"), received)
    }

    @Test
    fun theModuleThatIsAttachedCanDetach() {
        val received = mutableListOf<String>()
        val sink = Sink { event, _ -> received += event }
        bridge.attach(sink)
        bridge.detach(sink)
        connect()
        assertTrue("nobody is listening", received.isEmpty())
    }

    // ── leaving ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun leavingTheCarForgetsEverythingAndTellsTheApp() {
        listen()
        val controller = connect()
        bridge.root(card())
        events.clear()

        controller.moveToState(Lifecycle.State.DESTROYED)
        assertEquals(listOf("onDisconnected"), names().filter { it == "onDisconnected" })
        assertFalse(bridge.isConnected())
        assertNull(bridge.modelFor(CarBridge.ROOT_SLOT))
        assertFalse("the next drive's screens are the app's to send again", bridge.root(card()))
    }

    private companion object {
        const val BOOT_WAIT = 5_000L
    }
}
