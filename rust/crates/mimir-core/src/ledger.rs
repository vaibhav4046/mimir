use mimir_security::resilience::check_backpressure;
use mimir_security::MimirError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("security/resilience error: {0}")]
    Security(#[from] MimirError),

    #[error("lock poisoned")]
    LockPoisoned,

    #[error("not found: {0}")]
    NotFound(String),

    #[error("lease conflict: {0}")]
    LeaseConflict(String),
}

pub type CoreResult<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Clone, Deserialize)]
pub struct EnqueueRequest {
    pub id: String,
    pub idempotency_key: Option<String>,
    pub queue: String,
    pub kind: String,
    pub priority: i32,
    pub payload: serde_json::Value,
    pub max_attempts: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: String,
    pub idempotency_key: Option<String>,
    pub queue: String,
    pub kind: String,
    pub priority: i32,
    pub status: String,
    pub payload: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub last_error: Option<String>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub worker_id: Option<String>,
    pub lease_expires_at: Option<i64>,
    pub available_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnqueueOutcome {
    pub deduplicated: bool,
    pub task: TaskRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClaimRequest {
    pub worker_id: String,
    pub queue: Option<String>,
    pub lease_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteRequest {
    pub task_id: String,
    pub worker_id: String,
    pub result: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FailRequest {
    pub task_id: String,
    pub worker_id: String,
    pub error: String,
    pub base_backoff_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerRecord {
    pub id: String,
    pub host: String,
    pub max_concurrency: i32,
    pub active_tasks: i32,
    pub capabilities: Vec<String>,
    pub status: String,
    pub last_heartbeat_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub kind: String,
    pub format: String,
    pub file_path: String,
    pub sha256: String,
    pub size_bytes: i64,
    pub favorite: bool,
    pub verified: bool,
    pub bot_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: i64,
    pub category: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LedgerMetrics {
    pub queued: i64,
    pub running: i64,
    pub completed: i64,
    pub dead_letter: i64,
    pub workers_online: i64,
    pub artifacts_total: i64,
    pub idempotency_hits: u64,
    pub reclaimed_leases: u64,
}

#[derive(Clone)]
pub struct MimirLedger {
    conn: Arc<Mutex<Connection>>,
    max_queue_depth: usize,
    idempotency_hits: Arc<Mutex<u64>>,
    reclaimed_leases: Arc<Mutex<u64>>,
}

impl MimirLedger {
    pub fn open(db_path: impl AsRef<Path>, max_queue_depth: usize) -> CoreResult<Self> {
        if let Some(parent) = db_path.as_ref().parent() {
            std::fs::create_dir_all(parent).map_err(MimirError::Io)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                idempotency_key TEXT UNIQUE,
                queue TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 5,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json TEXT,
                last_error TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                worker_id TEXT,
                lease_expires_at INTEGER,
                available_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_claim
                ON tasks(status, available_at, priority, created_at);

            CREATE TABLE IF NOT EXISTS workers (
                id TEXT PRIMARY KEY,
                host TEXT NOT NULL,
                max_concurrency INTEGER NOT NULL DEFAULT 2,
                active_tasks INTEGER NOT NULL DEFAULT 0,
                capabilities_json TEXT NOT NULL,
                status TEXT NOT NULL,
                last_heartbeat_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                folder TEXT NOT NULL DEFAULT 'General',
                kind TEXT NOT NULL,
                format TEXT NOT NULL,
                file_path TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0,
                verified INTEGER NOT NULL DEFAULT 1,
                bot_id TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            ",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            max_queue_depth: max_queue_depth.max(4),
            idempotency_hits: Arc::new(Mutex::new(0)),
            reclaimed_leases: Arc::new(Mutex::new(0)),
        })
    }

    pub fn enqueue(&self, req: EnqueueRequest, now_ms: i64) -> CoreResult<EnqueueOutcome> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;

        if let Some(ref key) = req.idempotency_key {
            if !key.trim().is_empty() {
                if let Some(existing) = query_task_by_idem(&tx, key)? {
                    if let Ok(mut guard) = self.idempotency_hits.lock() {
                        *guard = guard.saturating_add(1);
                    }
                    return Ok(EnqueueOutcome {
                        deduplicated: true,
                        task: existing,
                    });
                }
            }
        }

        let pending_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status IN ('queued', 'running')",
            [],
            |r| r.get(0),
        )?;
        check_backpressure(pending_count.max(0) as usize, self.max_queue_depth)?;

        let payload_str = serde_json::to_string(&req.payload)?;
        let idem = req
            .idempotency_key
            .filter(|k| !k.trim().is_empty());
        let max_attempts = req.max_attempts.max(1);

        tx.execute(
            "INSERT INTO tasks (id, idempotency_key, queue, kind, priority, status, payload_json, attempts, max_attempts, available_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, 0, ?7, ?8, ?8, ?8)",
            params![
                req.id,
                idem,
                req.queue,
                req.kind,
                req.priority,
                payload_str,
                max_attempts,
                now_ms
            ],
        )?;

        insert_audit(&tx, "queue", "coordinator", "enqueue", &format!("{} ({})", req.id, req.kind), now_ms)?;
        let inserted = query_task_by_id(&tx, &req.id)?
            .ok_or_else(|| CoreError::NotFound(req.id.clone()))?;
        tx.commit()?;

        Ok(EnqueueOutcome {
            deduplicated: false,
            task: inserted,
        })
    }

    pub fn claim(&self, req: ClaimRequest, now_ms: i64) -> CoreResult<Option<TaskRecord>> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;

        reclaim_expired_tx(&tx, now_ms, &self.reclaimed_leases)?;

        let candidate_id: Option<String> = if let Some(ref queue_name) = req.queue {
            tx.query_row(
                "SELECT id FROM tasks
                 WHERE status = 'queued' AND queue = ?1 AND available_at <= ?2
                 ORDER BY priority DESC, created_at ASC
                 LIMIT 1",
                params![queue_name, now_ms],
                |r| r.get(0),
            )
            .optional()?
        } else {
            tx.query_row(
                "SELECT id FROM tasks
                 WHERE status = 'queued' AND available_at <= ?1
                 ORDER BY priority DESC, created_at ASC
                 LIMIT 1",
                params![now_ms],
                |r| r.get(0),
            )
            .optional()?
        };

        let Some(task_id) = candidate_id else {
            tx.commit()?;
            return Ok(None);
        };

        let lease_until = now_ms.saturating_add(req.lease_ms.max(50));
        tx.execute(
            "UPDATE tasks
             SET status = 'running',
                 worker_id = ?2,
                 lease_expires_at = ?3,
                 attempts = attempts + 1,
                 updated_at = ?4
             WHERE id = ?1 AND status = 'queued'",
            params![task_id, req.worker_id, lease_until, now_ms],
        )?;

        let task = query_task_by_id(&tx, &task_id)?;
        tx.commit()?;
        Ok(task)
    }

    pub fn heartbeat(&self, task_id: &str, worker_id: &str, lease_ms: i64, now_ms: i64) -> CoreResult<TaskRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let new_expiry = now_ms.saturating_add(lease_ms.max(50));
        let changed = conn.execute(
            "UPDATE tasks
             SET lease_expires_at = ?3, updated_at = ?4
             WHERE id = ?1 AND worker_id = ?2 AND status = 'running'",
            params![task_id, worker_id, new_expiry, now_ms],
        )?;
        if changed == 0 {
            return Err(CoreError::LeaseConflict(format!(
                "task '{task_id}' not leased by worker '{worker_id}'"
            )));
        }
        query_task_by_id(&conn, task_id)?.ok_or_else(|| CoreError::NotFound(task_id.to_string()))
    }

    pub fn complete(&self, req: CompleteRequest, now_ms: i64) -> CoreResult<TaskRecord> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;
        let res_str = serde_json::to_string(&req.result)?;
        let changed = tx.execute(
            "UPDATE tasks
             SET status = 'completed', result_json = ?3, lease_expires_at = NULL, updated_at = ?4
             WHERE id = ?1 AND worker_id = ?2 AND status = 'running'",
            params![req.task_id, req.worker_id, res_str, now_ms],
        )?;
        if changed == 0 {
            return Err(CoreError::LeaseConflict(format!(
                "cannot complete task '{}' — lease lost or mismatched worker '{}'",
                req.task_id, req.worker_id
            )));
        }
        insert_audit(&tx, "queue", &req.worker_id, "complete", &req.task_id, now_ms)?;
        let task = query_task_by_id(&tx, &req.task_id)?
            .ok_or_else(|| CoreError::NotFound(req.task_id.clone()))?;
        tx.commit()?;
        Ok(task)
    }

    pub fn fail(&self, req: FailRequest, now_ms: i64) -> CoreResult<TaskRecord> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;
        let current = query_task_by_id(&tx, &req.task_id)?
            .ok_or_else(|| CoreError::NotFound(req.task_id.clone()))?;
        if current.status != "running" || current.worker_id.as_deref() != Some(req.worker_id.as_str()) {
            return Err(CoreError::LeaseConflict(format!(
                "task '{}' not actively leased by '{}'",
                req.task_id, req.worker_id
            )));
        }

        if current.attempts >= current.max_attempts {
            tx.execute(
                "UPDATE tasks
                 SET status = 'dead_letter', last_error = ?2, lease_expires_at = NULL, updated_at = ?3
                 WHERE id = ?1",
                params![req.task_id, req.error, now_ms],
            )?;
            insert_audit(&tx, "queue", &req.worker_id, "dead_letter", &format!("{}: {}", req.task_id, req.error), now_ms)?;
        } else {
            let exp = (current.attempts.saturating_sub(1)).clamp(0, 6) as u32;
            let delay = req.base_backoff_ms.max(50).saturating_mul(1i64 << exp);
            let next_avail = now_ms.saturating_add(delay);
            tx.execute(
                "UPDATE tasks
                 SET status = 'queued', last_error = ?2, worker_id = NULL, lease_expires_at = NULL, available_at = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![req.task_id, req.error, next_avail, now_ms],
            )?;
            insert_audit(&tx, "queue", &req.worker_id, "retry_scheduled", &format!("{} in {}ms", req.task_id, delay), now_ms)?;
        }

        let updated = query_task_by_id(&tx, &req.task_id)?
            .ok_or_else(|| CoreError::NotFound(req.task_id.clone()))?;
        tx.commit()?;
        Ok(updated)
    }

    pub fn reclaim_stale_leases(&self, now_ms: i64) -> CoreResult<usize> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;
        let count = reclaim_expired_tx(&tx, now_ms, &self.reclaimed_leases)?;
        tx.commit()?;
        Ok(count)
    }

    pub fn requeue_dlq(&self, task_id: &str, now_ms: i64) -> CoreResult<TaskRecord> {
        let mut conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE tasks
             SET status = 'queued', attempts = 0, worker_id = NULL, lease_expires_at = NULL, available_at = ?2, updated_at = ?2
             WHERE id = ?1 AND status = 'dead_letter'",
            params![task_id, now_ms],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound(format!(
                "dead_letter task not found: {task_id}"
            )));
        }
        insert_audit(&tx, "queue", "operator", "requeue_dlq", task_id, now_ms)?;
        let task = query_task_by_id(&tx, task_id)?
            .ok_or_else(|| CoreError::NotFound(task_id.to_string()))?;
        tx.commit()?;
        Ok(task)
    }

    pub fn list_tasks(&self, status_filter: Option<&str>, limit: usize) -> CoreResult<Vec<TaskRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let mut stmt = if status_filter.is_some() {
            conn.prepare(
                "SELECT id, idempotency_key, queue, kind, priority, status, payload_json, result_json, last_error, attempts, max_attempts, worker_id, lease_expires_at, available_at, created_at, updated_at
                 FROM tasks WHERE status = ?1 ORDER BY updated_at DESC LIMIT ?2",
            )?
        } else {
            conn.prepare(
                "SELECT id, idempotency_key, queue, kind, priority, status, payload_json, result_json, last_error, attempts, max_attempts, worker_id, lease_expires_at, available_at, created_at, updated_at
                 FROM tasks ORDER BY updated_at DESC LIMIT ?1",
            )?
        };
        let lim = limit.clamp(1, 500) as i64;
        let rows = if let Some(st) = status_filter {
            stmt.query_map(params![st, lim], row_to_task)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(params![lim], row_to_task)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut out = Vec::with_capacity(rows.len());
        for raw in rows {
            out.push(raw.into_task()?);
        }
        Ok(out)
    }

    pub fn upsert_worker(&self, worker: WorkerRecord) -> CoreResult<WorkerRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let caps_json = serde_json::to_string(&worker.capabilities)?;
        conn.execute(
            "INSERT INTO workers (id, host, max_concurrency, active_tasks, capabilities_json, status, last_heartbeat_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                host = excluded.host,
                max_concurrency = excluded.max_concurrency,
                active_tasks = excluded.active_tasks,
                capabilities_json = excluded.capabilities_json,
                status = excluded.status,
                last_heartbeat_at = excluded.last_heartbeat_at",
            params![
                worker.id,
                worker.host,
                worker.max_concurrency,
                worker.active_tasks,
                caps_json,
                worker.status,
                worker.last_heartbeat_at
            ],
        )?;
        Ok(worker)
    }

    pub fn list_workers(&self, now_ms: i64, stale_after_ms: i64) -> CoreResult<Vec<WorkerRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, host, max_concurrency, active_tasks, capabilities_json, status, last_heartbeat_at
             FROM workers ORDER BY last_heartbeat_at DESC",
        )?;
        let mut out = Vec::new();
        let rows = stmt.query_map([], |r| {
            let caps_s: String = r.get(4)?;
            let hb: i64 = r.get(6)?;
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i32>(2)?,
                r.get::<_, i32>(3)?,
                caps_s,
                r.get::<_, String>(5)?,
                hb,
            ))
        })?;
        for item in rows {
            let (id, host, max_c, act, caps_s, st, hb) = item?;
            let caps: Vec<String> = serde_json::from_str(&caps_s).unwrap_or_default();
            let eff_status = if now_ms.saturating_sub(hb) > stale_after_ms {
                "stale".to_string()
            } else {
                st
            };
            out.push(WorkerRecord {
                id,
                host,
                max_concurrency: max_c,
                active_tasks: act,
                capabilities: caps,
                status: eff_status,
                last_heartbeat_at: hb,
            });
        }
        Ok(out)
    }

    pub fn upsert_artifact(&self, art: ArtifactRecord) -> CoreResult<ArtifactRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        conn.execute(
            "INSERT INTO artifacts (id, title, folder, kind, format, file_path, sha256, size_bytes, favorite, verified, bot_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                folder = excluded.folder,
                kind = excluded.kind,
                format = excluded.format,
                file_path = excluded.file_path,
                sha256 = excluded.sha256,
                size_bytes = excluded.size_bytes,
                favorite = excluded.favorite,
                verified = excluded.verified",
            params![
                art.id,
                art.title,
                art.folder,
                art.kind,
                art.format,
                art.file_path,
                art.sha256,
                art.size_bytes,
                i32::from(art.favorite),
                i32::from(art.verified),
                art.bot_id,
                art.created_at,
            ],
        )?;
        Ok(art)
    }

    pub fn update_artifact_meta(
        &self,
        id: &str,
        favorite: Option<bool>,
        folder: Option<&str>,
    ) -> CoreResult<ArtifactRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        if let Some(fav) = favorite {
            conn.execute(
                "UPDATE artifacts SET favorite = ?2 WHERE id = ?1",
                params![id, i32::from(fav)],
            )?;
        }
        if let Some(fld) = folder {
            conn.execute(
                "UPDATE artifacts SET folder = ?2 WHERE id = ?1",
                params![id, fld],
            )?;
        }
        conn.query_row(
            "SELECT id, title, folder, kind, format, file_path, sha256, size_bytes, favorite, verified, bot_id, created_at
             FROM artifacts WHERE id = ?1",
            params![id],
            row_to_artifact,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("artifact not found: {id}")))
    }

    pub fn delete_artifact(&self, id: &str) -> CoreResult<Option<ArtifactRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let existing = conn
            .query_row(
                "SELECT id, title, folder, kind, format, file_path, sha256, size_bytes, favorite, verified, bot_id, created_at
                 FROM artifacts WHERE id = ?1",
                params![id],
                row_to_artifact,
            )
            .optional()?;
        if existing.is_some() {
            conn.execute("DELETE FROM artifacts WHERE id = ?1", params![id])?;
        }
        Ok(existing)
    }

    pub fn list_artifacts(&self) -> CoreResult<Vec<ArtifactRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, title, folder, kind, format, file_path, sha256, size_bytes, favorite, verified, bot_id, created_at
             FROM artifacts ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_artifact)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_audit(&self, limit: usize) -> CoreResult<Vec<AuditEvent>> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, category, actor, action, detail, created_at
             FROM audit_log ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 200) as i64], |r| {
                Ok(AuditEvent {
                    id: r.get(0)?,
                    category: r.get(1)?,
                    actor: r.get(2)?,
                    action: r.get(3)?,
                    detail: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn metrics(&self, now_ms: i64, stale_after_ms: i64) -> CoreResult<LedgerMetrics> {
        let conn = self.conn.lock().map_err(|_| CoreError::LockPoisoned)?;
        let queued: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE status = 'queued'", [], |r| r.get(0))?;
        let running: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE status = 'running'", [], |r| r.get(0))?;
        let completed: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE status = 'completed'", [], |r| r.get(0))?;
        let dead_letter: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE status = 'dead_letter'", [], |r| r.get(0))?;
        let cutoff = now_ms.saturating_sub(stale_after_ms);
        let workers_online: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workers WHERE status = 'online' AND last_heartbeat_at >= ?1",
            params![cutoff],
            |r| r.get(0),
        )?;
        let artifacts_total: i64 = conn.query_row("SELECT COUNT(*) FROM artifacts", [], |r| r.get(0))?;
        let idempotency_hits = self.idempotency_hits.lock().map(|g| *g).unwrap_or(0);
        let reclaimed_leases = self.reclaimed_leases.lock().map(|g| *g).unwrap_or(0);
        Ok(LedgerMetrics {
            queued,
            running,
            completed,
            dead_letter,
            workers_online,
            artifacts_total,
            idempotency_hits,
            reclaimed_leases,
        })
    }
}

struct RawTaskRow {
    id: String,
    idempotency_key: Option<String>,
    queue: String,
    kind: String,
    priority: i32,
    status: String,
    payload_json: String,
    result_json: Option<String>,
    last_error: Option<String>,
    attempts: i32,
    max_attempts: i32,
    worker_id: Option<String>,
    lease_expires_at: Option<i64>,
    available_at: i64,
    created_at: i64,
    updated_at: i64,
}

impl RawTaskRow {
    fn into_task(self) -> CoreResult<TaskRecord> {
        let payload: serde_json::Value = serde_json::from_str(&self.payload_json)?;
        let result = match self.result_json {
            Some(s) => Some(serde_json::from_str(&s)?),
            None => None,
        };
        Ok(TaskRecord {
            id: self.id,
            idempotency_key: self.idempotency_key,
            queue: self.queue,
            kind: self.kind,
            priority: self.priority,
            status: self.status,
            payload,
            result,
            last_error: self.last_error,
            attempts: self.attempts,
            max_attempts: self.max_attempts,
            worker_id: self.worker_id,
            lease_expires_at: self.lease_expires_at,
            available_at: self.available_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn row_to_task(r: &rusqlite::Row<'_>) -> rusqlite::Result<RawTaskRow> {
    Ok(RawTaskRow {
        id: r.get(0)?,
        idempotency_key: r.get(1)?,
        queue: r.get(2)?,
        kind: r.get(3)?,
        priority: r.get(4)?,
        status: r.get(5)?,
        payload_json: r.get(6)?,
        result_json: r.get(7)?,
        last_error: r.get(8)?,
        attempts: r.get(9)?,
        max_attempts: r.get(10)?,
        worker_id: r.get(11)?,
        lease_expires_at: r.get(12)?,
        available_at: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

fn row_to_artifact(r: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactRecord> {
    let fav: i32 = r.get(8)?;
    let ver: i32 = r.get(9)?;
    Ok(ArtifactRecord {
        id: r.get(0)?,
        title: r.get(1)?,
        folder: r.get(2)?,
        kind: r.get(3)?,
        format: r.get(4)?,
        file_path: r.get(5)?,
        sha256: r.get(6)?,
        size_bytes: r.get(7)?,
        favorite: fav != 0,
        verified: ver != 0,
        bot_id: r.get(10)?,
        created_at: r.get(11)?,
    })
}

fn query_task_by_id(conn: &Connection, id: &str) -> CoreResult<Option<TaskRecord>> {
    let raw = conn
        .query_row(
            "SELECT id, idempotency_key, queue, kind, priority, status, payload_json, result_json, last_error, attempts, max_attempts, worker_id, lease_expires_at, available_at, created_at, updated_at
             FROM tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )
        .optional()?;
    match raw {
        Some(r) => Ok(Some(r.into_task()?)),
        None => Ok(None),
    }
}

fn query_task_by_idem(conn: &Connection, key: &str) -> CoreResult<Option<TaskRecord>> {
    let raw = conn
        .query_row(
            "SELECT id, idempotency_key, queue, kind, priority, status, payload_json, result_json, last_error, attempts, max_attempts, worker_id, lease_expires_at, available_at, created_at, updated_at
             FROM tasks WHERE idempotency_key = ?1",
            params![key],
            row_to_task,
        )
        .optional()?;
    match raw {
        Some(r) => Ok(Some(r.into_task()?)),
        None => Ok(None),
    }
}

fn reclaim_expired_tx(
    tx: &rusqlite::Transaction<'_>,
    now_ms: i64,
    counter: &Arc<Mutex<u64>>,
) -> CoreResult<usize> {
    let dead_count = tx.execute(
        "UPDATE tasks
         SET status = 'dead_letter',
             last_error = COALESCE(last_error, 'worker lease expired at max attempts'),
             lease_expires_at = NULL,
             updated_at = ?1
         WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?1 AND attempts >= max_attempts",
        params![now_ms],
    )?;

    let requeued_count = tx.execute(
        "UPDATE tasks
         SET status = 'queued',
             worker_id = NULL,
             lease_expires_at = NULL,
             available_at = ?1,
             last_error = 'reclaimed after stale worker lease',
             updated_at = ?1
         WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?1 AND attempts < max_attempts",
        params![now_ms],
    )?;

    let total = dead_count + requeued_count;
    if total > 0 {
        if let Ok(mut g) = counter.lock() {
            *g = g.saturating_add(total as u64);
        }
        insert_audit(
            tx,
            "lease",
            "supervisor",
            "reclaim_stale",
            &format!("requeued={requeued_count}, dead_letter={dead_count}"),
            now_ms,
        )?;
    }
    Ok(total)
}

fn insert_audit(
    conn: &Connection,
    category: &str,
    actor: &str,
    action: &str,
    detail: &str,
    now_ms: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO audit_log (category, actor, action, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![category, actor, action, detail, now_ms],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durable_lease_recovery_idempotency_and_dlq() -> CoreResult<()> {
        let dir = tempfile::tempdir().map_err(MimirError::Io)?;
        let db = dir.path().join("mimir.db");

        // Session 1: enqueue with idempotency key and worker crashes holding lease
        {
            let ledger = MimirLedger::open(&db, 16)?;
            let first = ledger.enqueue(
                EnqueueRequest {
                    id: "job-1".to_string(),
                    idempotency_key: Some("send-email-42".to_string()),
                    queue: "default".to_string(),
                    kind: "echo".to_string(),
                    priority: 10,
                    payload: serde_json::json!({ "msg": "hello" }),
                    max_attempts: 2,
                },
                1000,
            )?;
            assert!(!first.deduplicated);

            let dup = ledger.enqueue(
                EnqueueRequest {
                    id: "job-2".to_string(),
                    idempotency_key: Some("send-email-42".to_string()),
                    queue: "default".to_string(),
                    kind: "echo".to_string(),
                    priority: 10,
                    payload: serde_json::json!({ "msg": "hello" }),
                    max_attempts: 2,
                },
                1005,
            )?;
            assert!(dup.deduplicated);
            assert_eq!(dup.task.id, "job-1");

            let claimed = ledger.claim(
                ClaimRequest {
                    worker_id: "worker-crashed".to_string(),
                    queue: None,
                    lease_ms: 2000,
                },
                1010,
            )?;
            assert!(claimed.is_some());
        }

        // Session 2: simulated restart after crash, lease expired at t=5000
        let ledger2 = MimirLedger::open(&db, 16)?;
        let claimed2 = ledger2.claim(
            ClaimRequest {
                worker_id: "worker-survivor".to_string(),
                queue: None,
                lease_ms: 2000,
            },
            5000,
        )?;
        let task2 = claimed2.ok_or_else(|| CoreError::NotFound("expected reclaimed job".to_string()))?;
        assert_eq!(task2.id, "job-1");
        assert_eq!(task2.attempts, 2);

        // Failing at max_attempts moves cleanly to dead_letter and requeue revives it
        let dlq = ledger2.fail(
            FailRequest {
                task_id: "job-1".to_string(),
                worker_id: "worker-survivor".to_string(),
                error: "timeout".to_string(),
                base_backoff_ms: 100,
            },
            5100,
        )?;
        assert_eq!(dlq.status, "dead_letter");

        let rev = ledger2.requeue_dlq("job-1", 5200)?;
        assert_eq!(rev.status, "queued");
        assert_eq!(rev.attempts, 0);
        Ok(())
    }
}
