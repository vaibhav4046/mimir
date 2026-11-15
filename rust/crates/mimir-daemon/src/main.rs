#![forbid(unsafe_code)]

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use mimir_core::ledger::{
    ArtifactRecord, ClaimRequest, CompleteRequest, CoreError, EnqueueRequest, FailRequest,
    MimirLedger, WorkerRecord,
};
use mimir_core::mimir_security::{
    resilience::{CircuitBreaker, TokenBucket},
    sandbox::resolve_safe_path,
    validator::validate_artifact,
    vault::{constant_time_eq, redact_tokens_and_secrets, RustVault, VaultEntry},
    MimirError,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct AppState {
    ledger: MimirLedger,
    vault: Option<Arc<Mutex<RustVault>>>,
    breakers: Arc<Mutex<HashMap<String, CircuitBreaker>>>,
    buckets: Arc<Mutex<HashMap<String, TokenBucket>>>,
    token: String,
    started_at_ms: i64,
}

#[derive(Serialize)]
struct ApiErrBody {
    error: String,
    code: &'static str,
}

enum ApiError {
    BadRequest(String),
    Unauthorized,
    TooManyRequests(String),
    ServiceUnavailable(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, msg) = match self {
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, "bad_request", m),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid X-Mimir-Token".to_string(),
            ),
            Self::TooManyRequests(m) => (StatusCode::TOO_MANY_REQUESTS, "rate_or_backpressure", m),
            Self::ServiceUnavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, "circuit_open", m),
            Self::NotFound(m) => (StatusCode::NOT_FOUND, "not_found", m),
            Self::Conflict(m) => (StatusCode::CONFLICT, "lease_conflict", m),
            Self::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error", m),
        };
        (status, Json(ApiErrBody { error: msg, code })).into_response()
    }
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::Security(MimirError::RateLimited(k)) => {
                Self::TooManyRequests(format!("rate limit exceeded for '{k}'"))
            }
            CoreError::Security(MimirError::Backpressure { max }) => {
                Self::TooManyRequests(format!("backpressure queue capacity reached ({max})"))
            }
            CoreError::Security(MimirError::CircuitOpen(p)) => {
                Self::ServiceUnavailable(format!("circuit breaker open for '{p}'"))
            }
            CoreError::Security(MimirError::SandboxViolation(m))
            | CoreError::Security(MimirError::InvalidInput(m))
            | CoreError::Security(MimirError::ValidationFailed(m)) => Self::BadRequest(m),
            CoreError::NotFound(m) => Self::NotFound(m),
            CoreError::LeaseConflict(m) => Self::Conflict(m),
            other => Self::Internal(other.to_string()),
        }
    }
}

impl From<MimirError> for ApiError {
    fn from(err: MimirError) -> Self {
        CoreError::Security(err).into()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_u64() -> u64 {
    now_ms().max(0) as u64
}

async fn security_headers_mw(req: Request<axum::body::Body>, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    res
}

async fn auth_mw(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request<axum::body::Body>,
    next: Next,
) -> std::result::Result<Response, ApiError> {
    if req.uri().path() == "/health" {
        return Ok(next.run(req).await);
    }
    // x-grokbot-token is the pre-rename header, still accepted from older coordinators.
    let provided = headers
        .get("x-mimir-token")
        .or_else(|| headers.get("x-grokbot-token"))
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
        })
        .unwrap_or("");

    if !constant_time_eq(provided, &state.token) {
        return Err(ApiError::Unauthorized);
    }
    Ok(next.run(req).await)
}

async fn health_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "engine": "mimir-daemon-rust",
        "version": env!("CARGO_PKG_VERSION"),
        "uptimeMs": now_ms().saturating_sub(state.started_at_ms),
    }))
}

async fn metrics_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let ts = now_ms();
    let ledger = state.ledger.metrics(ts, 20_000)?;
    let breaker_states: BTreeMap<String, serde_json::Value> = state
        .breakers
        .lock()
        .map_err(|_| ApiError::Internal("breaker lock poisoned".to_string()))?
        .iter()
        .map(|(k, b)| {
            (
                k.clone(),
                serde_json::to_value(b.snapshot()).unwrap_or(serde_json::Value::Null),
            )
        })
        .collect();
    Ok(Json(serde_json::json!({
        "ok": true,
        "engine": "rust-wal",
        "uptimeMs": ts.saturating_sub(state.started_at_ms),
        "ledger": ledger,
        "breakers": breaker_states,
    })))
}

#[derive(Deserialize)]
struct ApiEnqueue {
    id: Option<String>,
    idempotency_key: Option<String>,
    queue: Option<String>,
    kind: String,
    priority: Option<i32>,
    payload: Option<serde_json::Value>,
    max_attempts: Option<i32>,
    rate_limit_key: Option<String>,
}

async fn enqueue_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiEnqueue>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let ts_u64 = now_u64();
    if let Some(ref rl_key) = body.rate_limit_key {
        let mut buckets = state
            .buckets
            .lock()
            .map_err(|_| ApiError::Internal("bucket lock poisoned".to_string()))?;
        let bucket = buckets
            .entry(rl_key.clone())
            .or_insert_with(|| TokenBucket::new(20, 4.0, ts_u64));
        bucket.try_consume(rl_key, 1, ts_u64)?;
    }

    let id = body
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("task-{ts_u64}"));
    let outcome = state.ledger.enqueue(
        EnqueueRequest {
            id,
            idempotency_key: body.idempotency_key,
            queue: body.queue.unwrap_or_else(|| "default".to_string()),
            kind: body.kind,
            priority: body.priority.unwrap_or(5),
            payload: body.payload.unwrap_or_else(|| serde_json::json!({})),
            max_attempts: body.max_attempts.unwrap_or(3),
        },
        now_ms(),
    )?;
    Ok(Json(serde_json::to_value(outcome).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiClaim {
    worker_id: String,
    queue: Option<String>,
    lease_ms: Option<i64>,
}

async fn claim_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiClaim>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let task = state.ledger.claim(
        ClaimRequest {
            worker_id: body.worker_id,
            queue: body.queue,
            lease_ms: body.lease_ms.unwrap_or(15_000),
        },
        now_ms(),
    )?;
    Ok(Json(serde_json::json!({ "task": task })))
}

#[derive(Deserialize)]
struct ApiHeartbeat {
    task_id: String,
    worker_id: String,
    lease_ms: Option<i64>,
}

async fn heartbeat_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiHeartbeat>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let task = state.ledger.heartbeat(
        &body.task_id,
        &body.worker_id,
        body.lease_ms.unwrap_or(15_000),
        now_ms(),
    )?;
    Ok(Json(serde_json::to_value(task).map_err(|e| ApiError::Internal(e.to_string()))?))
}

async fn complete_handler(
    State(state): State<AppState>,
    Json(body): Json<CompleteRequest>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let task = state.ledger.complete(body, now_ms())?;
    Ok(Json(serde_json::to_value(task).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiFail {
    task_id: String,
    worker_id: String,
    error: String,
    base_backoff_ms: Option<i64>,
}

async fn fail_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiFail>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let task = state.ledger.fail(
        FailRequest {
            task_id: body.task_id,
            worker_id: body.worker_id,
            error: body.error,
            base_backoff_ms: body.base_backoff_ms.unwrap_or(1_000),
        },
        now_ms(),
    )?;
    Ok(Json(serde_json::to_value(task).map_err(|e| ApiError::Internal(e.to_string()))?))
}

async fn reclaim_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let reclaimed = state.ledger.reclaim_stale_leases(now_ms())?;
    Ok(Json(serde_json::json!({ "reclaimed": reclaimed })))
}

#[derive(Deserialize)]
struct TasksQuery {
    status: Option<String>,
    limit: Option<usize>,
}

async fn list_tasks_handler(
    State(state): State<AppState>,
    Query(q): Query<TasksQuery>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let tasks = state
        .ledger
        .list_tasks(q.status.as_deref(), q.limit.unwrap_or(100))?;
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

async fn requeue_dlq_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let task = state.ledger.requeue_dlq(&id, now_ms())?;
    Ok(Json(serde_json::to_value(task).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiWorker {
    id: String,
    host: Option<String>,
    max_concurrency: Option<i32>,
    active_tasks: Option<i32>,
    capabilities: Option<Vec<String>>,
    status: Option<String>,
}

async fn worker_register_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiWorker>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let w = state.ledger.upsert_worker(WorkerRecord {
        id: body.id,
        host: body.host.unwrap_or_else(|| "127.0.0.1".to_string()),
        max_concurrency: body.max_concurrency.unwrap_or(2),
        active_tasks: body.active_tasks.unwrap_or(0),
        capabilities: body
            .capabilities
            .unwrap_or_else(|| vec!["compute".to_string(), "validate".to_string()]),
        status: body.status.unwrap_or_else(|| "online".to_string()),
        last_heartbeat_at: now_ms(),
    })?;
    Ok(Json(serde_json::to_value(w).map_err(|e| ApiError::Internal(e.to_string()))?))
}

async fn workers_list_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let workers = state.ledger.list_workers(now_ms(), 20_000)?;
    Ok(Json(serde_json::json!({ "workers": workers })))
}

#[derive(Deserialize)]
struct ApiSandboxCheck {
    root: String,
    path: String,
}

async fn sandbox_check_handler(
    Json(body): Json<ApiSandboxCheck>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let resolved = resolve_safe_path(std::path::Path::new(&body.root), &body.path)?;
    Ok(Json(serde_json::json!({
        "safe": true,
        "resolvedPath": resolved.to_string_lossy(),
    })))
}

#[derive(Deserialize)]
struct ApiRedact {
    text: String,
    extra_secrets: Option<Vec<String>>,
}

async fn redact_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiRedact>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let mut secrets = body.extra_secrets.unwrap_or_default();
    if let Some(ref v_arc) = state.vault {
        if let Ok(v) = v_arc.lock() {
            secrets.extend(v.all_secret_values());
        }
    }
    let redacted = redact_tokens_and_secrets(&body.text, &secrets);
    Ok(Json(serde_json::json!({ "redacted": redacted })))
}

#[derive(Deserialize)]
struct ApiCircuitReq {
    provider: String,
    outcome: Option<String>,
}

async fn circuit_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiCircuitReq>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let ts = now_u64();
    let mut map = state
        .breakers
        .lock()
        .map_err(|_| ApiError::Internal("breaker lock poisoned".to_string()))?;
    let breaker = map
        .entry(body.provider.clone())
        .or_insert_with(|| CircuitBreaker::new(3, 15_000));

    match body.outcome.as_deref() {
        Some("success") => breaker.record_success(),
        Some("failure") => breaker.record_failure(ts),
        _ => breaker.allow_request(&body.provider, ts)?,
    }
    Ok(Json(serde_json::to_value(breaker.snapshot()).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiValidateArtifact {
    path: String,
    format: String,
}

async fn validate_artifact_handler(
    Json(body): Json<ApiValidateArtifact>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let res = validate_artifact(std::path::Path::new(&body.path), &body.format)?;
    Ok(Json(serde_json::to_value(res).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiRegisterArtifact {
    id: String,
    title: String,
    folder: Option<String>,
    kind: String,
    format: String,
    file_path: String,
    favorite: Option<bool>,
    bot_id: Option<String>,
}

async fn register_artifact_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiRegisterArtifact>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let check = validate_artifact(std::path::Path::new(&body.file_path), &body.format)?;
    let rec = state.ledger.upsert_artifact(ArtifactRecord {
        id: body.id,
        title: body.title,
        folder: body.folder.unwrap_or_else(|| "General".to_string()),
        kind: body.kind,
        format: check.format,
        file_path: body.file_path,
        sha256: check.sha256,
        size_bytes: check.size_bytes as i64,
        favorite: body.favorite.unwrap_or(false),
        verified: check.valid,
        bot_id: body.bot_id,
        created_at: now_ms(),
    })?;
    Ok(Json(serde_json::to_value(rec).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
struct ApiPatchArtifact {
    favorite: Option<bool>,
    folder: Option<String>,
}

async fn patch_artifact_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<ApiPatchArtifact>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let rec = state
        .ledger
        .update_artifact_meta(&id, body.favorite, body.folder.as_deref())?;
    Ok(Json(serde_json::to_value(rec).map_err(|e| ApiError::Internal(e.to_string()))?))
}

async fn delete_artifact_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let removed = state.ledger.delete_artifact(&id)?;
    Ok(Json(serde_json::json!({ "deleted": removed.is_some(), "artifact": removed })))
}

async fn list_artifacts_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let items = state.ledger.list_artifacts()?;
    Ok(Json(serde_json::json!({ "artifacts": items })))
}

async fn audit_list_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let events = state.ledger.list_audit(100)?;
    Ok(Json(serde_json::json!({ "events": events })))
}

#[derive(Deserialize)]
struct ApiVaultSet {
    id: String,
    label: String,
    kind: String,
    fields: BTreeMap<String, String>,
}

async fn vault_list_handler(
    State(state): State<AppState>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let Some(ref v_arc) = state.vault else {
        return Err(ApiError::BadRequest("vault not enabled for this daemon".to_string()));
    };
    let v = v_arc
        .lock()
        .map_err(|_| ApiError::Internal("vault lock poisoned".to_string()))?;
    Ok(Json(serde_json::json!({ "entries": v.list_masked() })))
}

async fn vault_set_handler(
    State(state): State<AppState>,
    Json(body): Json<ApiVaultSet>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let Some(ref v_arc) = state.vault else {
        return Err(ApiError::BadRequest("vault not enabled for this daemon".to_string()));
    };
    let mut v = v_arc
        .lock()
        .map_err(|_| ApiError::Internal("vault lock poisoned".to_string()))?;
    let masked = v.set_entry(VaultEntry {
        id: body.id,
        label: body.label,
        kind: body.kind,
        fields: body.fields,
        updated_at: now_u64(),
    })?;
    Ok(Json(serde_json::to_value(masked).map_err(|e| ApiError::Internal(e.to_string()))?))
}

async fn vault_delete_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> std::result::Result<Json<serde_json::Value>, ApiError> {
    let Some(ref v_arc) = state.vault else {
        return Err(ApiError::BadRequest("vault not enabled for this daemon".to_string()));
    };
    let mut v = v_arc
        .lock()
        .map_err(|_| ApiError::Internal("vault lock poisoned".to_string()))?;
    let deleted = v.delete_entry(&id)?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

fn find_arg(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == flag)
        .map(|w| w[1].clone())
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn run_worker_loop(
    coordinator: &str,
    token: &str,
    worker_id: &str,
    max_concurrency: i32,
    once: bool,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let base = coordinator.trim_end_matches('/');
    let reg_url = format!("{base}/v1/rust/workers/register");
    let claim_url = format!("{base}/v1/rust/queue/claim");
    let complete_url = format!("{base}/v1/rust/queue/complete");
    let fail_url = format!("{base}/v1/rust/queue/fail");

    let reg_body = serde_json::json!({
        "id": worker_id,
        "host": "127.0.0.1",
        "max_concurrency": max_concurrency,
        "active_tasks": 0,
        "capabilities": ["validate_artifact", "redact_text", "sandbox_check", "echo"],
        "status": "online",
    });
    let _ = ureq::post(&reg_url)
        .set("X-Mimir-Token", token)
        .send_json(reg_body)?;

    loop {
        let _ = ureq::post(&reg_url)
            .set("X-Mimir-Token", token)
            .send_json(serde_json::json!({
                "id": worker_id,
                "max_concurrency": max_concurrency,
                "active_tasks": 0,
                "status": "online",
            }));

        let claim_res: serde_json::Value = ureq::post(&claim_url)
            .set("X-Mimir-Token", token)
            .send_json(serde_json::json!({
                "worker_id": worker_id,
                // Other queues (e.g. "routines") belong to the Node coordinator.
                "queue": "default",
                "lease_ms": 15000,
            }))?
            .into_json()?;

        if let Some(task) = claim_res.get("task").and_then(|v| v.as_object()) {
            let task_id = task.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let kind = task.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let payload = task.get("payload").cloned().unwrap_or(serde_json::Value::Null);

            let outcome: std::result::Result<serde_json::Value, String> = match kind {
                "echo" => Ok(serde_json::json!({ "echoed": payload, "worker": worker_id })),
                "redact_text" => {
                    let txt = payload.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    Ok(serde_json::json!({ "redacted": redact_tokens_and_secrets(txt, &[]) }))
                }
                "validate_artifact" => {
                    let p = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let fmt = payload.get("format").and_then(|v| v.as_str()).unwrap_or("");
                    validate_artifact(std::path::Path::new(p), fmt)
                        .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                        .map_err(|e| e.to_string())
                }
                other => Ok(serde_json::json!({ "ack": true, "kind": other, "worker": worker_id })),
            };

            match outcome {
                Ok(res) => {
                    let _ = ureq::post(&complete_url)
                        .set("X-Mimir-Token", token)
                        .send_json(serde_json::json!({
                            "task_id": task_id,
                            "worker_id": worker_id,
                            "result": res,
                        }))?;
                }
                Err(err_msg) => {
                    let _ = ureq::post(&fail_url)
                        .set("X-Mimir-Token", token)
                        .send_json(serde_json::json!({
                            "task_id": task_id,
                            "worker_id": worker_id,
                            "error": err_msg,
                            "base_backoff_ms": 1000,
                        }))?;
                }
            }

            if once {
                break;
            }
        } else {
            if once {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    if let Some(pos) = args.iter().position(|a| a == "--validate-artifact") {
        let p = args.get(pos + 1).ok_or("missing artifact path")?;
        let fmt = args.get(pos + 2).ok_or("missing artifact format")?;
        let res = validate_artifact(std::path::Path::new(p), fmt)?;
        println!("{}", serde_json::to_string_pretty(&res)?);
        return Ok(());
    }

    if has_flag(&args, "--worker") {
        let coord = find_arg(&args, "--coordinator")
            .unwrap_or_else(|| "http://127.0.0.1:4568".to_string());
        let token = find_arg(&args, "--token").unwrap_or_default();
        let worker_id = find_arg(&args, "--worker-id")
            .unwrap_or_else(|| format!("rust-worker-{}", now_u64()));
        let concurrency: i32 = find_arg(&args, "--concurrency")
            .and_then(|s| s.parse().ok())
            .unwrap_or(2);
        let once = has_flag(&args, "--once");
        return run_worker_loop(&coord, &token, &worker_id, concurrency, once);
    }

    let port: u16 = find_arg(&args, "--port")
        .or_else(|| std::env::var("MIMIR_RUST_PORT").ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(4568);

    let data_dir = find_arg(&args, "--data-dir")
        .or_else(|| std::env::var("MIMIR_DATA_DIR").ok())
        .or_else(|| std::env::var("GROKBOT_DATA_DIR").ok())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".mimir-rust-data"));

    let token = find_arg(&args, "--token")
        .or_else(|| std::env::var("MIMIR_RUST_TOKEN").ok())
        .or_else(|| std::env::var("MIMIR_TOKEN").ok())
        .or_else(|| std::env::var("GROKBOT_TOKEN").ok())
        .unwrap_or_else(|| "mimir-local-dev-token".to_string());

    let max_queue: usize = find_arg(&args, "--max-queue")
        .and_then(|s| s.parse().ok())
        .unwrap_or(256);

    let db_path = data_dir.join("mimir-rust.db");
    let ledger = MimirLedger::open(&db_path, max_queue)?;

    let vault_opt = if let Some(pass) = find_arg(&args, "--vault-pass")
        .or_else(|| std::env::var("MIMIR_VAULT_PASS").ok())
    {
        let v = RustVault::open(data_dir.join("vault.rust.enc"), pass)?;
        Some(Arc::new(Mutex::new(v)))
    } else {
        None
    };

    let state = AppState {
        ledger: ledger.clone(),
        vault: vault_opt,
        breakers: Arc::new(Mutex::new(HashMap::new())),
        buckets: Arc::new(Mutex::new(HashMap::new())),
        token,
        started_at_ms: now_ms(),
    };

    // Background stale-lease sweeper
    let sweeper_ledger = ledger.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            ticker.tick().await;
            let _ = sweeper_ledger.reclaim_stale_leases(now_ms());
        }
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/rust/metrics", get(metrics_handler))
        .route("/v1/rust/queue/enqueue", post(enqueue_handler))
        .route("/v1/rust/queue/claim", post(claim_handler))
        .route("/v1/rust/queue/heartbeat", post(heartbeat_handler))
        .route("/v1/rust/queue/complete", post(complete_handler))
        .route("/v1/rust/queue/fail", post(fail_handler))
        .route("/v1/rust/queue/reclaim", post(reclaim_handler))
        .route("/v1/rust/queue/tasks", get(list_tasks_handler))
        .route("/v1/rust/queue/dlq/{id}/requeue", post(requeue_dlq_handler))
        .route(
            "/v1/rust/workers/register",
            post(worker_register_handler),
        )
        .route("/v1/rust/workers", get(workers_list_handler))
        .route("/v1/rust/sandbox/check", post(sandbox_check_handler))
        .route("/v1/rust/redact", post(redact_handler))
        .route("/v1/rust/circuit", post(circuit_handler))
        .route(
            "/v1/rust/artifacts/validate",
            post(validate_artifact_handler),
        )
        .route(
            "/v1/rust/artifacts",
            get(list_artifacts_handler).post(register_artifact_handler),
        )
        .route(
            "/v1/rust/artifacts/{id}",
            patch(patch_artifact_handler).delete(delete_artifact_handler),
        )
        .route("/v1/rust/audit", get(audit_list_handler))
        .route("/v1/rust/vault", get(vault_list_handler).post(vault_set_handler))
        .route("/v1/rust/vault/{id}", axum::routing::delete(vault_delete_handler))
        .layer(middleware::from_fn_with_state(state.clone(), auth_mw))
        .layer(middleware::from_fn(security_headers_mw))
        .with_state(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    println!("MIMIR_RUST_DAEMON_READY http://{bound}");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}
