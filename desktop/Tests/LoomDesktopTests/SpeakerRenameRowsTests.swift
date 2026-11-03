import XCTest
@testable import LoomDesktopApp

final class SpeakerRenameRowsTests: XCTestCase {
    private let ana = PersonDTO(id: "p-ana", displayName: "Ana Lima", email: nil, isSelf: false)
    private let bill = PersonDTO(id: "p-bill", displayName: "Bill Ortiz", email: "bill@x.test", isSelf: false)
    private let chirag = PersonDTO(id: "p-chirag", displayName: "Chirag Rao", email: nil, isSelf: false)
    private let me = PersonDTO(id: "p-me", displayName: "Ian Cross", email: nil, isSelf: true)

    private var people: [PersonDTO] { [chirag, me, bill, ana] }

    func testEmptyQueryListsAttendeesFirstThenTheRestAlphabetically() {
        let rows = SpeakerRenameRows.build(query: "", people: people, attendeeIds: ["p-chirag"])
        XCTAssertEqual(rows, [.person(chirag), .person(ana), .person(bill), .person(me)])
    }

    func testWhitespaceQueryCountsAsEmpty() {
        let rows = SpeakerRenameRows.build(query: "   ", people: people, attendeeIds: [])
        XCTAssertEqual(rows, [.person(ana), .person(bill), .person(chirag), .person(me)])
    }

    func testQueryFiltersCaseInsensitivelyAndKeepsAttendeesFirst() {
        // "i" matches Ana Lima, Bill Ortiz, Chirag Rao and Ian Cross; Bill is the attendee.
        let rows = SpeakerRenameRows.build(query: "I", people: people, attendeeIds: ["p-bill"])
        XCTAssertEqual(Array(rows.prefix(4)), [.person(bill), .person(ana), .person(chirag), .person(me)])
    }

    func testUnknownNameOffersAddingAPersonThenAOneOffLabel() {
        let rows = SpeakerRenameRows.build(query: "  Dana  ", people: people, attendeeIds: [])
        XCTAssertEqual(rows, [.createPerson("Dana"), .labelOnly("Dana")])
    }

    func testExactMatchOffersNoCreateOrLabelRows() {
        let rows = SpeakerRenameRows.build(query: "bill ortiz", people: people, attendeeIds: [])
        XCTAssertEqual(rows, [.person(bill)])
    }

    func testPartialMatchStillOffersTheTypedNameAfterThePeople() {
        let rows = SpeakerRenameRows.build(query: "Bil", people: people, attendeeIds: [])
        XCTAssertEqual(rows, [.person(bill), .createPerson("Bil"), .labelOnly("Bil")])
    }

    func testNoPeopleAtAllStillLetsYouTypeAName() {
        XCTAssertEqual(SpeakerRenameRows.build(query: "", people: [], attendeeIds: []), [])
        XCTAssertEqual(
            SpeakerRenameRows.build(query: "Dana", people: [], attendeeIds: []),
            [.createPerson("Dana"), .labelOnly("Dana")]
        )
    }

    func testReturnPicksTheFirstRow() {
        XCTAssertEqual(SpeakerRenameRows.submitTarget(query: "Bil", people: people, attendeeIds: []), .person(bill))
        XCTAssertEqual(SpeakerRenameRows.submitTarget(query: "Dana", people: people, attendeeIds: []), .createPerson("Dana"))
        XCTAssertNil(SpeakerRenameRows.submitTarget(query: "", people: [], attendeeIds: []))
    }
}
