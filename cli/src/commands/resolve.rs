//! ID prefix resolution.
//!
//! Subcommands accept any unambiguous prefix of an item or list id —
//! the user types `a1b2c3`, we expand it to the full uuid hex. Built-in
//! lists (`current`, `holding`) match literally regardless of length so
//! `airday ls --list current` always works.

use airday_core::{Doc, ItemView, ListView};

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("no item matches `{0}`")]
    ItemNotFound(String),
    #[error("no list matches `{0}`")]
    ListNotFound(String),
    #[error("`{prefix}` is ambiguous — matches: {}", matches.join(", "))]
    Ambiguous {
        prefix: String,
        matches: Vec<String>,
    },
}

/// Resolve a user-supplied prefix to a single item's full id.
pub fn resolve_item_id(doc: &Doc, prefix: &str) -> Result<String, ResolveError> {
    let prefix = prefix.trim();
    let lists = doc.all_lists();
    let mut all_items: Vec<ItemView> = Vec::new();
    for l in &lists {
        all_items.extend(doc.items_in_list(&l.id, true));
    }
    let matches: Vec<String> = all_items
        .iter()
        .map(|i| i.id.clone())
        .filter(|id| id.starts_with(prefix))
        .collect();
    pick_one(prefix, matches, ResolveError::ItemNotFound(prefix.to_string()))
}

/// Resolve a user-supplied prefix to a single list's full id. Accepts
/// the built-in ids (`current`, `holding`) verbatim.
pub fn resolve_list_id(doc: &Doc, prefix: &str) -> Result<String, ResolveError> {
    let prefix = prefix.trim();
    let lists = doc.all_lists();
    if lists.iter().any(|l| l.id == prefix) {
        return Ok(prefix.to_string());
    }
    let matches: Vec<String> = lists
        .iter()
        .map(|l| l.id.clone())
        .filter(|id| id.starts_with(prefix))
        .collect();
    pick_one(prefix, matches, ResolveError::ListNotFound(prefix.to_string()))
}

fn pick_one(
    prefix: &str,
    mut matches: Vec<String>,
    not_found: ResolveError,
) -> Result<String, ResolveError> {
    match matches.len() {
        0 => Err(not_found),
        1 => Ok(matches.remove(0)),
        _ => Err(ResolveError::Ambiguous {
            prefix: prefix.to_string(),
            matches: matches.into_iter().map(|m| short_id(&m)).collect(),
        }),
    }
}

/// 6-char display form of an id. Built-in list ids (`current`,
/// `holding`) round-trip verbatim because they're already short.
pub fn short_id(id: &str) -> String {
    if id.len() <= 6 {
        return id.to_string();
    }
    id.chars().take(6).collect()
}

/// Convenience: collect the full and short forms of an item.
#[allow(dead_code)]
pub fn short_item_id(item: &ItemView) -> String {
    short_id(&item.id)
}

#[allow(dead_code)]
pub fn short_list_id(list: &ListView) -> String {
    short_id(&list.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use airday_core::{LIST_CURRENT, LIST_HOLDING};

    #[test]
    fn resolves_unique_item_prefix() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_CURRENT, "thing").unwrap();
        let prefix = &id[..6];
        assert_eq!(resolve_item_id(&doc, prefix).unwrap(), id);
    }

    #[test]
    fn ambiguous_prefix_reports_matches() {
        // Force a collision by reaching for entries that share a
        // common "" prefix — every id starts with the empty string, so
        // an empty prefix is the most-ambiguous case.
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_CURRENT, "a").unwrap();
        let _b = doc.add_item(LIST_CURRENT, "b").unwrap();
        let err = resolve_item_id(&doc, "").unwrap_err();
        match err {
            ResolveError::Ambiguous { matches, .. } => assert_eq!(matches.len(), 2),
            other => panic!("expected Ambiguous, got {other:?}"),
        }
    }

    #[test]
    fn missing_prefix_is_not_found() {
        let doc = Doc::new().unwrap();
        let err = resolve_item_id(&doc, "deadbeef").unwrap_err();
        assert!(matches!(err, ResolveError::ItemNotFound(_)));
    }

    #[test]
    fn builtin_list_resolves_verbatim() {
        let doc = Doc::new().unwrap();
        assert_eq!(resolve_list_id(&doc, LIST_CURRENT).unwrap(), LIST_CURRENT);
        assert_eq!(resolve_list_id(&doc, LIST_HOLDING).unwrap(), LIST_HOLDING);
    }

    #[test]
    fn user_list_resolves_by_prefix() {
        let doc = Doc::new().unwrap();
        let id = doc.add_list("Errands").unwrap();
        let prefix = &id[..6];
        assert_eq!(resolve_list_id(&doc, prefix).unwrap(), id);
    }
}
