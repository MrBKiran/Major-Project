package expo.modules.autosaarthicar

import androidx.car.app.model.Action
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The templates the car is given. The Car App Library checks its own rules as each template is
 * built — how many buttons, which kinds of button, how many rows — so a model that builds here is
 * one a car's host accepts.
 */
@RunWith(RobolectricTestRunner::class)
class TemplateBuilderTest {

    private val taps = mutableListOf<Pair<String, String>>()
    private val onAction: (String, String) -> Unit = { screen, action -> taps += screen to action }
    private val limits = Limits(list = 6, pane = 4)

    private fun pane(model: CarScreenModel, limits: Limits = this.limits) =
        TemplateBuilder.build(model, limits, onAction) as PaneTemplate

    private fun list(model: CarScreenModel, limits: Limits = this.limits) =
        TemplateBuilder.build(model, limits, onAction) as ListTemplate

    private fun message(model: CarScreenModel) = TemplateBuilder.build(model, limits, onAction) as MessageTemplate

    private val card = CarScreenModel(
        id = "status", kind = CarKind.PANE, title = "Bolero · MH12AB1001",
        rows = listOf(
            CarRow("Your water pump is wearing out", listOf("Urgent · 5 days", "About 5 days of driving left, on current use.")),
            CarRow("Repair now ₹2,400", listOf("If it fails on the road ₹18,500")),
        ),
        actions = listOf(CarAction("book", "Book a service", primary = true, parkedOnly = true), CarAction("refresh", "Refresh")),
    )

    @Test
    fun aPaneCarriesItsRowsTitleAndButtons() {
        val template = pane(card)
        assertEquals("Bolero · MH12AB1001", template.title.toString())
        assertSame(Action.APP_ICON, template.headerAction)
        val rows = template.pane.rows
        assertEquals(2, rows.size)
        assertEquals("Your water pump is wearing out", (rows[0] as Row).title.toString())
        assertEquals(listOf("Urgent · 5 days", "About 5 days of driving left, on current use."), (rows[0] as Row).texts.map { it.toString() })
        assertEquals(listOf("Book a service", "Refresh"), template.pane.actions.map { it.title.toString() })
    }

    @Test
    fun theMainButtonIsMarkedPrimaryAndRefusedWhileMoving() {
        val actions = pane(card).pane.actions
        assertTrue(actions[0].flags and Action.FLAG_PRIMARY != 0)
        assertTrue("booking is parked-only on the car's own host too", actions[0].onClickDelegate!!.isParkedOnly)
        assertFalse(actions[1].onClickDelegate!!.isParkedOnly)
    }

    @Test
    fun tappingAButtonTellsTheAppWhichScreenAndWhichButton() {
        val actions = pane(card).pane.actions
        actions[1].onClickDelegate!!.tap()
        assertEquals(listOf("status" to "refresh"), taps)
    }

    @Test
    fun aPaneShowsOnlyAsManyRowsAsTheHostAllows() {
        val many = card.copy(rows = (1..6).map { CarRow("Row $it") })
        assertEquals(listOf("Row 1", "Row 2"), pane(many, Limits(list = 6, pane = 2)).pane.rows.map { (it as Row).title.toString() })
    }

    @Test
    fun aBackScreenShowsABackArrowInsteadOfTheAppIcon() {
        assertSame(Action.BACK, pane(card.copy(back = true)).headerAction)
    }

    @Test
    fun aLoadingPaneHasNoRowsOrButtons() {
        val template = pane(card.copy(loading = true))
        assertTrue(template.pane.isLoading)
        assertTrue(template.pane.rows.isEmpty())
        assertTrue(template.pane.actions.isEmpty())
    }

    @Test
    fun aPaneWithNothingInItSaysWhatItIs() {
        val template = pane(card.copy(rows = emptyList(), actions = emptyList()))
        assertEquals("Bolero · MH12AB1001", (template.pane.rows.single() as Row).title.toString())
    }

    private val times = CarScreenModel(
        id = "slots", kind = CarKind.LIST, title = "Pick a time", back = true, empty = "No times are free right now.",
        rows = listOf(
            CarRow("Mon 23 Nov, 9:00 am", listOf("Pune Central"), action = "slot:0", parkedOnly = true),
            CarRow("Tue 24 Nov, 11:00 am", listOf("Pune Central"), action = "slot:1", parkedOnly = true),
            CarRow("Just a note"),
        ),
    )

    @Test
    fun aListRowIsTappableOnlyWhenItHasAnAction() {
        val items = list(times).singleList!!.items.map { it as Row }
        assertEquals(3, items.size)
        assertNotNull(items[0].onClickDelegate)
        assertTrue(items[0].onClickDelegate!!.isParkedOnly)
        assertNull(items[2].onClickDelegate)
        items[1].onClickDelegate!!.tap()
        assertEquals(listOf("slots" to "slot:1"), taps)
    }

    @Test
    fun aListShowsOnlyAsManyRowsAsTheHostAllows() {
        assertEquals(1, list(times, Limits(list = 1, pane = 4)).singleList!!.items.size)
    }

    @Test
    fun aListSaysWhatToShowWhenItHasNoRows() {
        val template = list(times.copy(rows = emptyList()))
        assertEquals("No times are free right now.", template.singleList!!.noItemsMessage.toString())
    }

    @Test
    fun aListCanCarryButtonsInItsActionStrip() {
        val template = list(times.copy(actions = listOf(CarAction("refresh", "Refresh"))))
        assertEquals(listOf("Refresh"), template.actionStrip!!.actions.map { it.title.toString() })
    }

    @Test
    fun aLoadingListHasNoRows() {
        val template = list(times.copy(loading = true))
        assertTrue(template.isLoading)
        assertNull(template.singleList)
    }

    @Test
    fun aMessageIsOneSentenceWithAtMostTwoButtons() {
        val template = message(
            CarScreenModel(
                id = "booked", kind = CarKind.MESSAGE, title = "Booked", message = "Mon 23 Nov, 9:00 am at Pune Central.",
                actions = listOf(CarAction("done", "Done", primary = true)),
            ),
        )
        assertEquals("Mon 23 Nov, 9:00 am at Pune Central.", template.message.toString())
        assertEquals("Booked", template.title.toString())
        assertEquals(listOf("Done"), template.actions.map { it.title.toString() })
        assertFalse(template.isLoading)
    }

    @Test
    fun aMessageCanShowASpinner() {
        val template = message(CarScreenModel(id = "wait", kind = CarKind.MESSAGE, title = "AutoSaarthi", message = "Booking…", loading = true))
        assertTrue(template.isLoading)
    }
}
