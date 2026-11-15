use thiserror::Error;

#[derive(Debug, Error)]
pub enum MimirError {
    #[error("sandbox violation: {0}")]
    SandboxViolation(String),

    #[error("vault error: {0}")]
    Vault(String),

    #[error("invalid argument: {0}")]
    InvalidInput(String),

    #[error("rate limit exceeded for key '{0}'")]
    RateLimited(String),

    #[error("circuit breaker open for provider '{0}'")]
    CircuitOpen(String),

    #[error("backpressure queue capacity reached ({max})")]
    Backpressure { max: usize },

    #[error("artifact validation failed: {0}")]
    ValidationFailed(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, MimirError>;
