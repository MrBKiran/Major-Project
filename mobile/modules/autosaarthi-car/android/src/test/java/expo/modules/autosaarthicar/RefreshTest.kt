package expo.modules.autosaarthicar

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which changes the host counts. The rules are the template documentation's: a pane or a list is
 * refreshed if the title and the number of rows and each row's title are unchanged, or if the
 * previous one was loading; a message if its title and message are unchanged; a different kind of
 * template never is. A mistake in the generous direction costs the app, so these are read strictly.
 */
class RefreshTest {

    private fun pane(
        title: String = "Bolero",
        rows: List<CarRow> = listOf(CarRow("Health", listOf("About 5 days of driving left"))),
        loading: Boolean = false,
        back: Boolean = false,
        actions: List<CarAction> = emptyList(),
    ) = CarScreenModel(id = "status", kind = CarKind.PANE, title = title, rows = rows, loading = loading, back = back, actions = actions)

    private fun list(rows: List<CarRow>, title: String = "Pick a time") =
        CarScreenModel(id = "slots", kind = CarKind.LIST, title = title, rows = rows)

    private fun message(title: String = "AutoSaarthi", message: String = "No connection right now.") =
        CarScreenModel(id = "status", kind = CarKind.MESSAGE, title = title, message = message)

    @Test
    fun anythingIsARefreshOfNothing() {
        assertTrue(Refresh.isRefresh(null, pane()))
    }

    @Test
    fun newTextUnderTheSameTitlesIsARefresh() {
        val next = pane(rows = listOf(CarRow("Health", listOf("About 4 days of driving left"))))
        assertTrue(Refresh.isRefresh(pane(), next))
    }

    @Test
    fun buttonsMayComeAndGoInARefresh() {
        assertTrue(Refresh.isRefresh(pane(), pane(actions = listOf(CarAction("book", "Book a service")))))
    }

    @Test
    fun aNewTitleIsNotARefresh() {
        assertFalse(Refresh.isRefresh(pane(), pane(title = "Thar")))
    }

    @Test
    fun aNewRowTitleIsNotARefresh() {
        assertFalse(Refresh.isRefresh(pane(), pane(rows = listOf(CarRow("Cost")))))
    }

    @Test
    fun aRowMoreOrFewerIsNotARefresh() {
        assertFalse(Refresh.isRefresh(pane(), pane(rows = listOf(CarRow("Health"), CarRow("Cost")))))
        assertFalse(Refresh.isRefresh(pane(rows = listOf(CarRow("Health"), CarRow("Cost"))), pane()))
    }

    @Test
    fun aPaneThatFollowsALoadingPaneIsARefreshWhateverItHolds() {
        val loading = pane(title = "AutoSaarthi", rows = emptyList(), loading = true)
        assertTrue(Refresh.isRefresh(loading, pane(title = "Bolero · MH12AB1001", rows = listOf(CarRow("A"), CarRow("B")))))
    }

    @Test
    fun aLoadingPaneThatReplacesAFullOneIsNot() {
        assertFalse(Refresh.isRefresh(pane(), pane(title = "AutoSaarthi", rows = emptyList(), loading = true)))
    }

    @Test
    fun aListIsRefreshedByTheSameRowTitlesAndNotByNewOnes() {
        val a = list(listOf(CarRow("Mon 23 Nov, 9:00 am", listOf("Pune Central")), CarRow("Tue 24 Nov, 9:00 am", listOf("Pune Central"))))
        val sameTitlesNewText = list(listOf(CarRow("Mon 23 Nov, 9:00 am", listOf("Pune West")), CarRow("Tue 24 Nov, 9:00 am", listOf("Pune West"))))
        val newTimes = list(listOf(CarRow("Mon 23 Nov, 10:00 am"), CarRow("Tue 24 Nov, 9:00 am")))
        assertTrue(Refresh.isRefresh(a, sameTitlesNewText))
        assertFalse(Refresh.isRefresh(a, newTimes))
        assertFalse(Refresh.isRefresh(a, list(a.rows.take(1))))
    }

    @Test
    fun aMessageIsRefreshedOnlyByTheSameTitleAndWords() {
        assertTrue(Refresh.isRefresh(message(), message().copy(loading = true, actions = listOf(CarAction("retry", "Try again")))))
        assertFalse(Refresh.isRefresh(message(), message(message = "Booked.")))
        assertFalse(Refresh.isRefresh(message(), message(title = "Booking")))
    }

    @Test
    fun aDifferentKindOfTemplateIsNeverARefresh() {
        assertFalse(Refresh.isRefresh(pane(), message()))
        assertFalse(Refresh.isRefresh(message(), pane()))
        assertFalse(Refresh.isRefresh(pane(rows = emptyList(), loading = true), message()))
        assertFalse(Refresh.isRefresh(list(emptyList()), pane()))
    }

    @Test
    fun aDifferentHeaderIsNotCalledARefresh() {
        // The documentation does not say a header may change in a refresh, so this does not assume it.
        assertFalse(Refresh.isRefresh(pane(), pane(back = true)))
    }
}
