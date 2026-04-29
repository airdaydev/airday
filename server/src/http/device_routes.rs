//! Device list / register / revoke handlers. All require bearer auth.

use airday_protocol::{
    Device, DeviceCredential, DeviceRegistration, DevicesListResponse,
};
use axum::extract::{Path, State};
use uuid::Uuid;

use crate::auth::queries::{create_device, list_devices, revoke_device};
use crate::auth::tokens::{encode_token, generate_token, sha256};
use crate::auth::DeviceAuth;
use crate::error::{ApiError, ApiResult};
use crate::http::msgpack::Msgpack;
use crate::state::AppState;

pub async fn list(
    State(state): State<AppState>,
    auth: DeviceAuth,
) -> ApiResult<Msgpack<DevicesListResponse>> {
    let rows = list_devices(&state.db, auth.account_id).await?;
    Ok(Msgpack(DevicesListResponse {
        devices: rows
            .into_iter()
            .map(|d| Device {
                id: d.id.to_string(),
                name: d.name,
                last_seen_at: d.last_seen_at,
                created_at: d.created_at,
            })
            .collect(),
    }))
}

pub async fn register(
    State(state): State<AppState>,
    auth: DeviceAuth,
    Msgpack(req): Msgpack<DeviceRegistration>,
) -> ApiResult<Msgpack<DeviceCredential>> {
    if req.name.trim().is_empty() {
        return Err(ApiError::BadRequest("name is required".into()));
    }
    let token = generate_token();
    let device_id = create_device(
        &state.db,
        auth.account_id,
        req.name,
        sha256(&token).to_vec(),
    )
    .await?;
    Ok(Msgpack(DeviceCredential {
        device_id: device_id.to_string(),
        device_token: encode_token(&token),
    }))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: DeviceAuth,
    Path(device_id): Path<String>,
) -> ApiResult<()> {
    let target =
        Uuid::parse_str(&device_id).map_err(|_| ApiError::BadRequest("invalid device id".into()))?;
    let removed = revoke_device(&state.db, auth.account_id, target).await?;
    if !removed {
        return Err(ApiError::NotFound);
    }
    Ok(())
}
