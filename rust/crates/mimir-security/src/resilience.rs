use crate::error::{MimirError, Result};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone)]
pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    refill_per_sec: f64,
    last_refill_ms: u64,
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_sec: f64, now_ms: u64) -> Self {
        let cap = f64::from(capacity.max(1));
        Self {
            capacity: cap,
            tokens: cap,
            refill_per_sec: refill_per_sec.max(0.01),
            last_refill_ms: now_ms,
        }
    }

    pub fn try_consume(&mut self, key: &str, cost: u32, now_ms: u64) -> Result<f64> {
        let elapsed_sec = now_ms.saturating_sub(self.last_refill_ms) as f64 / 1000.0;
        self.tokens = (self.tokens + elapsed_sec * self.refill_per_sec).min(self.capacity);
        self.last_refill_ms = now_ms;
        let needed = f64::from(cost);
        if self.tokens >= needed {
            self.tokens -= needed;
            Ok(self.tokens)
        } else {
            Err(MimirError::RateLimited(key.to_string()))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Serialize)]
pub struct CircuitSnapshot {
    pub state: BreakerState,
    pub consecutive_failures: u32,
    pub total_trips: u64,
    pub opened_at_ms: u64,
}

#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    failure_threshold: u32,
    reset_timeout_ms: u64,
    state: BreakerState,
    consecutive_failures: u32,
    opened_at_ms: u64,
    total_trips: u64,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, reset_timeout_ms: u64) -> Self {
        Self {
            failure_threshold: failure_threshold.max(1),
            reset_timeout_ms: reset_timeout_ms.max(100),
            state: BreakerState::Closed,
            consecutive_failures: 0,
            opened_at_ms: 0,
            total_trips: 0,
        }
    }

    pub fn allow_request(&mut self, provider: &str, now_ms: u64) -> Result<()> {
        match self.state {
            BreakerState::Closed | BreakerState::HalfOpen => Ok(()),
            BreakerState::Open => {
                if now_ms.saturating_sub(self.opened_at_ms) >= self.reset_timeout_ms {
                    self.state = BreakerState::HalfOpen;
                    Ok(())
                } else {
                    Err(MimirError::CircuitOpen(provider.to_string()))
                }
            }
        }
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.state = BreakerState::Closed;
    }

    pub fn record_failure(&mut self, now_ms: u64) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.state == BreakerState::HalfOpen || self.consecutive_failures >= self.failure_threshold {
            self.state = BreakerState::Open;
            self.opened_at_ms = now_ms;
            self.total_trips = self.total_trips.saturating_add(1);
        }
    }

    pub fn snapshot(&self) -> CircuitSnapshot {
        CircuitSnapshot {
            state: self.state,
            consecutive_failures: self.consecutive_failures,
            total_trips: self.total_trips,
            opened_at_ms: self.opened_at_ms,
        }
    }
}

#[derive(Debug, Clone)]
struct CacheEntry<V> {
    value: V,
    expires_at_ms: u64,
}

pub struct BoundedTtlCache<V> {
    max_entries: usize,
    entries: HashMap<String, CacheEntry<V>>,
    order: VecDeque<String>,
}

impl<V: Clone> BoundedTtlCache<V> {
    pub fn new(max_entries: usize) -> Self {
        Self {
            max_entries: max_entries.max(1),
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn get(&mut self, key: &str, now_ms: u64) -> Option<V> {
        let expired = self
            .entries
            .get(key)
            .is_some_and(|e| now_ms >= e.expires_at_ms);
        if expired {
            self.entries.remove(key);
            return None;
        }
        self.entries.get(key).map(|e| e.value.clone())
    }

    pub fn insert(&mut self, key: impl Into<String>, value: V, ttl_ms: u64, now_ms: u64) {
        let key_s = key.into();
        if !self.entries.contains_key(&key_s) {
            while self.entries.len() >= self.max_entries {
                if let Some(oldest) = self.order.pop_front() {
                    self.entries.remove(&oldest);
                } else {
                    break;
                }
            }
            self.order.push_back(key_s.clone());
        }
        self.entries.insert(
            key_s,
            CacheEntry {
                value,
                expires_at_ms: now_ms.saturating_add(ttl_ms),
            },
        );
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

pub fn check_backpressure(pending_count: usize, max_queue_depth: usize) -> Result<()> {
    if pending_count >= max_queue_depth {
        return Err(MimirError::Backpressure {
            max: max_queue_depth,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_enforces_burst_and_refills() -> Result<()> {
        let mut b = TokenBucket::new(2, 1.0, 1000);
        b.try_consume("ollama", 1, 1000)?;
        b.try_consume("ollama", 1, 1000)?;
        assert!(b.try_consume("ollama", 1, 1000).is_err());
        b.try_consume("ollama", 1, 2100)?;
        Ok(())
    }

    #[test]
    fn circuit_breaker_opens_half_opens_and_closes() -> Result<()> {
        let mut cb = CircuitBreaker::new(2, 5000);
        cb.allow_request("github", 100)?;
        cb.record_failure(110);
        cb.record_failure(120);
        assert!(cb.allow_request("github", 1000).is_err());
        cb.allow_request("github", 5200)?;
        assert_eq!(cb.snapshot().state, BreakerState::HalfOpen);
        cb.record_success();
        assert_eq!(cb.snapshot().state, BreakerState::Closed);
        Ok(())
    }

    #[test]
    fn bounded_cache_evicts_and_expires() {
        let mut cache = BoundedTtlCache::new(2);
        cache.insert("k1", "v1", 500, 100);
        cache.insert("k2", "v2", 5000, 100);
        cache.insert("k3", "v3", 5000, 100);
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get("k1", 200), None);
        assert_eq!(cache.get("k2", 200), Some("v2"));
        assert_eq!(cache.get("k2", 6000), None);
    }
}
