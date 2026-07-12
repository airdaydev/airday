use airday_core::doc::{Doc, LIST_INBOX};

#[test]
fn move_item_to_same_visible_slot_is_noop() {
    let doc = Doc::new().unwrap();
    let a = doc.add_item(LIST_INBOX, "a").unwrap();
    let b = doc.add_item(LIST_INBOX, "b").unwrap();
    let c = doc.add_item(LIST_INBOX, "c").unwrap();

    doc.move_item(&b, LIST_INBOX, 1).unwrap();

    assert_eq!(doc.open_item_ids(LIST_INBOX), vec![a, b, c]);
}

#[test]
fn move_item_down_uses_resulting_visible_index() {
    let doc = Doc::new().unwrap();
    let a = doc.add_item(LIST_INBOX, "a").unwrap();
    let b = doc.add_item(LIST_INBOX, "b").unwrap();
    let c = doc.add_item(LIST_INBOX, "c").unwrap();
    let d = doc.add_item(LIST_INBOX, "d").unwrap();

    doc.move_item(&b, LIST_INBOX, 2).unwrap();

    assert_eq!(doc.open_item_ids(LIST_INBOX), vec![a, c, b, d]);
}

#[test]
fn undo_redo_roundtrips_reorder_with_hidden_items() {
    let doc = Doc::new().unwrap();
    let other = doc.add_list("Other").unwrap();
    let a = doc.add_item(LIST_INBOX, "a").unwrap();
    let b = doc.add_item(LIST_INBOX, "b").unwrap();
    let c = doc.add_item(LIST_INBOX, "c").unwrap();
    let hidden = doc.add_item(&other, "hidden").unwrap();
    doc.set_item_done(&hidden, true).unwrap();

    doc.move_item(&a, LIST_INBOX, 2).unwrap();
    doc.move_item(&b, &other, 0).unwrap();
    let expected_main = doc.open_item_ids(LIST_INBOX);
    let expected_other = doc.open_item_ids(&other);

    while doc.can_undo() {
        assert!(doc.undo().unwrap());
    }
    assert!(doc.open_item_ids(LIST_INBOX).is_empty());
    assert!(doc.open_item_ids(&other).is_empty());

    while doc.can_redo() {
        assert!(doc.redo().unwrap());
    }
    assert_eq!(doc.open_item_ids(LIST_INBOX), expected_main);
    assert_eq!(doc.open_item_ids(&other), expected_other);
    assert_eq!(doc.open_item_ids(LIST_INBOX), vec![c, a]);
    assert_eq!(doc.open_item_ids(&other), vec![b]);
}
