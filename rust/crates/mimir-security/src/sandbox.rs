use crate::error::{MimirError, Result};
use std::fs;
use std::path::{Component, Path, PathBuf};

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_windows_reserved_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("");
    let upper = stem.to_ascii_uppercase();
    WINDOWS_RESERVED.contains(&upper.as_str())
}

/// Canonicalize `rel_path` strictly under `root`, defending against traversal (`..`),
/// Windows drive prefixes, reserved device filenames, NTFS alternate data streams,
/// and symlink/junction escapes through existing ancestors.
pub fn resolve_safe_path(root: &Path, rel_path: &str) -> Result<PathBuf> {
    if rel_path.contains('\0') {
        return Err(MimirError::SandboxViolation(
            "path contains NUL byte".to_string(),
        ));
    }
    let trimmed = rel_path.trim();
    if trimmed.is_empty() || trimmed == "." {
        fs::create_dir_all(root)?;
        return Ok(fs::canonicalize(root)?);
    }

    if trimmed.contains(':') {
        return Err(MimirError::SandboxViolation(
            "drive prefixes or NTFS alternate data streams are blocked".to_string(),
        ));
    }

    let candidate = Path::new(trimmed);
    let mut clean_segments: Vec<String> = Vec::new();
    for comp in candidate.components() {
        match comp {
            Component::CurDir => {}
            Component::Normal(os_str) => {
                let s = os_str.to_string_lossy();
                if is_windows_reserved_name(&s) {
                    return Err(MimirError::SandboxViolation(format!(
                        "reserved OS filename blocked: {s}"
                    )));
                }
                clean_segments.push(s.into_owned());
            }
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(MimirError::SandboxViolation(format!(
                    "path traversal or absolute root blocked: {trimmed}"
                )));
            }
        }
    }

    fs::create_dir_all(root)?;
    let canonical_root = fs::canonicalize(root)?;

    let mut probe = canonical_root.clone();
    for seg in &clean_segments {
        probe.push(seg);
    }

    // Walk up until an existing ancestor is found, canonicalize it (resolving symlinks/junctions),
    // and ensure the resolved ancestor remains inside canonical_root.
    let mut existing = probe.clone();
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        if let Some(name) = existing.file_name() {
            trailing.push(name.to_os_string());
        }
        if !existing.pop() {
            break;
        }
    }

    let canonical_existing = fs::canonicalize(&existing)?;
    if !canonical_existing.starts_with(&canonical_root) {
        return Err(MimirError::SandboxViolation(
            "symlink or ancestor escapes sandbox root".to_string(),
        ));
    }

    let mut final_path = canonical_existing;
    for part in trailing.into_iter().rev() {
        final_path.push(part);
    }

    // Also guard if the full probe already exists and is a symlink to outside.
    if probe.exists() {
        let canonical_target = fs::canonicalize(&probe)?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(MimirError::SandboxViolation(
                "target symlink resolves outside sandbox root".to_string(),
            ));
        }
        return Ok(canonical_target);
    }

    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_valid_nested_relative_path() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let res = resolve_safe_path(dir.path(), "reports/2026/summary.md")?;
        let canon_root = fs::canonicalize(dir.path())?;
        assert!(res.starts_with(&canon_root));
        assert!(res.ends_with("summary.md"));
        Ok(())
    }

    #[test]
    fn blocks_traversal_and_reserved_names() -> Result<()> {
        let dir = tempfile::tempdir()?;
        for bad in [
            "../secret.txt",
            "a/../../b",
            "/etc/passwd",
            "C:\\Windows\\System32",
            "notes.txt:hidden",
            "CON.txt",
            "sub/nul",
            "bad\0file.txt",
        ] {
            let err = resolve_safe_path(dir.path(), bad);
            assert!(err.is_err(), "expected failure for '{bad}'");
        }
        Ok(())
    }
}
