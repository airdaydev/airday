// Authorisation framework & caching (does user x have access to resource y)
use crate::AppState;
use uuid::Uuid;

// TODO: This could actually be a method on user
// TODO: Forward the reason why?
// TODO: Cache results
pub async fn has_library_access(state: &AppState, user_id: Option<Uuid>, library_id: Uuid) -> bool {
    let Some(user_id) = user_id else {
        // Unauthorised/anon, ignore
        return false;
    };
    // Confirm user has access
    let Some(user) = state.db.user.get_by_id(&user_id).await.unwrap() else {
        // User no longer exists (TODO: This should never happen)
        return false;
    };

    // TODO: Extend for shared access
    let user_has_access = match user.primary_library {
        Some(lib) => lib.id == library_id,
        None => false,
    };

    return user_has_access;
}
