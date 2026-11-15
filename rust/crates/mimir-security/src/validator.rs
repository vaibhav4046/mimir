use crate::error::{MimirError, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize)]
pub struct ArtifactValidation {
    pub valid: bool,
    pub format: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub details: String,
}

pub fn validate_artifact(path: &Path, expected_format: &str) -> Result<ArtifactValidation> {
    if !path.exists() {
        return Err(MimirError::ValidationFailed(format!(
            "artifact does not exist: {}",
            path.display()
        )));
    }
    let bytes = fs::read(path)?;
    if bytes.is_empty() {
        return Err(MimirError::ValidationFailed("artifact is 0 bytes".to_string()));
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = hex::encode(hasher.finalize());
    let fmt = expected_format.trim().to_ascii_lowercase();

    let details = match fmt.as_str() {
        "pdf" => validate_pdf(&bytes)?,
        "png" => validate_png(&bytes)?,
        "svg" => validate_svg(&bytes)?,
        "glb" => validate_glb(&bytes)?,
        "obj" => validate_obj(&bytes)?,
        "stl" => validate_stl(&bytes)?,
        "webm" => validate_webm(&bytes)?,
        "mp4" => validate_mp4(&bytes)?,
        "gif" => validate_gif(&bytes)?,
        "wav" | "music" => validate_wav(&bytes)?,
        "webapp" => validate_bundle_zip(path, &["index.html", "app.js", "server.py"], "Full-stack WebApp bundle")?,
        "game" => validate_bundle_zip(path, &["index.html", "game.js"], "Playable Game bundle")?,
        "docx" => validate_ooxml(path, &["[Content_Types].xml", "word/document.xml"])?,
        "pptx" => validate_ooxml(path, &["[Content_Types].xml", "ppt/presentation.xml"])?,
        "xlsx" => validate_ooxml(path, &["[Content_Types].xml", "xl/workbook.xml"])?,
        "zip" => validate_zip(path)?,
        "json" => validate_json(&bytes)?,
        "csv" | "md" | "txt" | "html" => {
            std::str::from_utf8(&bytes).map_err(|_| {
                MimirError::ValidationFailed(format!("{fmt} is not valid UTF-8"))
            })?;
            format!("Valid UTF-8 {fmt} document ({} bytes)", bytes.len())
        }
        other => {
            return Err(MimirError::InvalidInput(format!(
                "unsupported validation format: {other}"
            )));
        }
    };

    Ok(ArtifactValidation {
        valid: true,
        format: fmt,
        size_bytes: bytes.len() as u64,
        sha256,
        details,
    })
}

fn validate_pdf(bytes: &[u8]) -> Result<String> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(MimirError::ValidationFailed(
            "missing %PDF- signature".to_string(),
        ));
    }
    let tail_start = bytes.len().saturating_sub(1024);
    let tail = String::from_utf8_lossy(&bytes[tail_start..]);
    if !tail.contains("%%EOF") {
        return Err(MimirError::ValidationFailed(
            "missing %%EOF trailer in PDF".to_string(),
        ));
    }
    Ok(format!("Verified PDF signature and %%EOF ({} bytes)", bytes.len()))
}

fn validate_png(bytes: &[u8]) -> Result<String> {
    const SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 24 || bytes[..8] != SIG || &bytes[12..16] != b"IHDR" {
        return Err(MimirError::ValidationFailed(
            "invalid PNG header or missing IHDR chunk".to_string(),
        ));
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        return Err(MimirError::ValidationFailed(
            "PNG dimensions cannot be 0x0".to_string(),
        ));
    }
    Ok(format!("Verified PNG image ({width}x{height}px)"))
}

fn validate_svg(bytes: &[u8]) -> Result<String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| MimirError::ValidationFailed("SVG is not valid UTF-8".to_string()))?;
    let lower = text.to_ascii_lowercase();
    if !lower.contains("<svg") || !lower.contains("</svg>") {
        return Err(MimirError::ValidationFailed(
            "missing <svg> root element".to_string(),
        ));
    }
    if lower.contains("<script") || lower.contains("javascript:") || lower.contains("onload=") {
        return Err(MimirError::ValidationFailed(
            "unsafe script or event handler found in SVG".to_string(),
        ));
    }
    Ok("Verified clean XML/SVG structure (no active script sinks)".to_string())
}

fn validate_ooxml(path: &Path, required_entries: &[&str]) -> Result<String> {
    let f = File::open(path)?;
    let mut archive = ZipArchive::new(f)
        .map_err(|e| MimirError::ValidationFailed(format!("invalid OOXML zip archive: {e}")))?;
    let mut entry_names = Vec::with_capacity(archive.len());
    let mut total_uncompressed: u64 = 0;
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| MimirError::ValidationFailed(format!("corrupt archive entry: {e}")))?;
        entry_names.push(entry.name().to_string());
        let mut buf = [0u8; 256];
        let _ = entry.read(&mut buf)?;
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
    }
    for req in required_entries {
        if !entry_names.iter().any(|n| n == req) {
            return Err(MimirError::ValidationFailed(format!(
                "missing required OOXML member '{req}'"
            )));
        }
    }
    Ok(format!(
        "Verified OOXML archive ({} entries, {} uncompressed bytes)",
        entry_names.len(),
        total_uncompressed
    ))
}

fn validate_zip(path: &Path) -> Result<String> {
    let f = File::open(path)?;
    let archive = ZipArchive::new(f)
        .map_err(|e| MimirError::ValidationFailed(format!("invalid zip archive: {e}")))?;
    if archive.is_empty() {
        return Err(MimirError::ValidationFailed(
            "zip archive contains no entries".to_string(),
        ));
    }
    Ok(format!("Verified ZIP archive ({} entries)", archive.len()))
}

fn validate_json(bytes: &[u8]) -> Result<String> {
    let _: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| MimirError::ValidationFailed(format!("invalid JSON: {e}")))?;
    Ok(format!("Verified JSON document ({} bytes)", bytes.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn validates_clean_svg_and_rejects_xss_svg() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let clean = dir.path().join("clean.svg");
        fs::write(&clean, "<svg viewBox='0 0 16 16'><rect width='16' height='16'/></svg>")?;
        let res = validate_artifact(&clean, "svg")?;
        assert!(res.valid);

        let bad = dir.path().join("bad.svg");
        fs::write(&bad, "<svg><script>alert(1)</script></svg>")?;
        assert!(validate_artifact(&bad, "svg").is_err());
        Ok(())
    }

    #[test]
    fn validates_ooxml_zip_package() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let docx = dir.path().join("sample.docx");
        let f = File::create(&docx)?;
        let mut zw = zip::ZipWriter::new(f);
        zw.start_file("[Content_Types].xml", SimpleFileOptions::default())
            .map_err(|e| MimirError::ValidationFailed(e.to_string()))?;
        zw.write_all(b"<Types/>")?;
        zw.start_file("word/document.xml", SimpleFileOptions::default())
            .map_err(|e| MimirError::ValidationFailed(e.to_string()))?;
        zw.write_all(b"<w:document/>")?;
        zw.finish()
            .map_err(|e| MimirError::ValidationFailed(e.to_string()))?;

        let check = validate_artifact(&docx, "docx")?;
        assert!(check.valid);
        assert!(check.details.contains("2 entries"));
        Ok(())
    }

    #[test]
    fn validates_3d_video_and_bundle_formats() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let dir = std::env::temp_dir().join(format!("mimir-val-multi-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;

        // Valid GLB header + JSON chunk
        let glb_path = dir.join("mesh.glb");
        let json_chunk = b"{\"asset\":{\"version\":\"2.0\"}}  ";
        let total_len = (12 + 8 + json_chunk.len()) as u32;
        let mut glb = Vec::new();
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&total_len.to_le_bytes());
        glb.extend_from_slice(&(json_chunk.len() as u32).to_le_bytes());
        glb.extend_from_slice(b"JSON");
        glb.extend_from_slice(json_chunk);
        std::fs::write(&glb_path, &glb)?;
        assert!(validate_artifact(&glb_path, "glb")?.valid);

        // Corrupt GLB rejected
        let bad_glb = dir.join("bad.glb");
        std::fs::write(&bad_glb, b"not-a-glb-file-000000000000000000")?;
        assert!(validate_artifact(&bad_glb, "glb").is_err());

        // Valid OBJ & STL
        let obj_path = dir.join("mesh.obj");
        std::fs::write(&obj_path, "o Cube\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")?;
        assert!(validate_artifact(&obj_path, "obj")?.valid);

        let stl_path = dir.join("mesh.stl");
        let mut stl = vec![0u8; 80 + 4 + 50];
        stl[80..84].copy_from_slice(&1u32.to_le_bytes());
        std::fs::write(&stl_path, &stl)?;
        assert!(validate_artifact(&stl_path, "stl")?.valid);

        // Valid WebM, MP4, GIF
        let webm_path = dir.join("clip.webm");
        let mut webm = vec![0x1A, 0x45, 0xDF, 0xA3];
        webm.extend_from_slice(&[0u8; 64]);
        std::fs::write(&webm_path, &webm)?;
        assert!(validate_artifact(&webm_path, "webm")?.valid);

        let mp4_path = dir.join("clip.mp4");
        let mut mp4 = vec![0, 0, 0, 20];
        mp4.extend_from_slice(b"ftypisom");
        mp4.extend_from_slice(&[0u8; 16]);
        std::fs::write(&mp4_path, &mp4)?;
        assert!(validate_artifact(&mp4_path, "mp4")?.valid);

        let gif_path = dir.join("clip.gif");
        std::fs::write(&gif_path, b"GIF89a\x01\x00\x01\x00\x00\x00\x00;")?;
        assert!(validate_artifact(&gif_path, "gif")?.valid);

        // Valid webapp & game bundles
        let webapp_path = dir.join("webapp.zip");
        {
            let file = std::fs::File::create(&webapp_path)?;
            let mut z = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            z.start_file("index.html", opts)?;
            z.write_all(b"<html></html>")?;
            z.start_file("app.js", opts)?;
            z.write_all(b"console.log('ok');")?;
            z.start_file("server.py", opts)?;
            z.write_all(b"from fastapi import FastAPI")?;
            z.finish()?;
        }
        assert!(validate_artifact(&webapp_path, "webapp")?.valid);

        let game_path = dir.join("game.zip");
        {
            let file = std::fs::File::create(&game_path)?;
            let mut z = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            z.start_file("index.html", opts)?;
            z.write_all(b"<html></html>")?;
            z.start_file("game.js", opts)?;
            z.write_all(b"console.log('game');")?;
            z.finish()?;
        }
        assert!(validate_artifact(&game_path, "game")?.valid);

        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }
}

fn validate_glb(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() < 28 || &bytes[0..4] != b"glTF" {
        return Err(MimirError::ValidationFailed(
            "Invalid GLB header magic (expected glTF)".into(),
        ));
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    if version != 2 {
        return Err(MimirError::ValidationFailed(format!(
            "Unsupported GLB version: {version}"
        )));
    }
    let declared_len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    if declared_len < 28 || declared_len > bytes.len() {
        return Err(MimirError::ValidationFailed(
            "GLB declared length out of bounds".into(),
        ));
    }
    if &bytes[16..20] != b"JSON" {
        return Err(MimirError::ValidationFailed(
            "GLB missing initial JSON chunk".into(),
        ));
    }
    Ok(format!("Valid binary glTF 2.0 3D model ({} bytes)", bytes.len()))
}

fn validate_obj(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| MimirError::ValidationFailed("OBJ is not valid UTF-8".into()))?;
    let vertex_count = text.lines().filter(|l| l.trim_start().starts_with("v ")).count();
    if vertex_count == 0 {
        return Err(MimirError::ValidationFailed(
            "OBJ contains no vertex definitions (v )".into(),
        ));
    }
    Ok(format!(
        "Valid Wavefront OBJ 3D mesh ({vertex_count} vertices, {} bytes)",
        bytes.len()
    ))
}

fn validate_stl(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() >= 84 {
        let tri_count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
        if tri_count > 0 && bytes.len() == 84 + tri_count.saturating_mul(50) {
            return Ok(format!(
                "Valid binary STL 3D mesh ({tri_count} triangles, {} bytes)",
                bytes.len()
            ));
        }
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        let trimmed = text.trim_start();
        if trimmed.starts_with("solid") && (text.contains("facet") || text.contains("endsolid")) {
            return Ok(format!("Valid ASCII STL 3D mesh ({} bytes)", bytes.len()));
        }
    }
    Err(MimirError::ValidationFailed(
        "Invalid STL binary/ASCII 3D mesh".into(),
    ))
}

fn validate_webm(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() < 32 || &bytes[0..4] != &[0x1A, 0x45, 0xDF, 0xA3] {
        return Err(MimirError::ValidationFailed(
            "Invalid WebM EBML container header".into(),
        ));
    }
    Ok(format!("Valid WebM video ({} bytes)", bytes.len()))
}

fn validate_mp4(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() < 16 || &bytes[4..8] != b"ftyp" {
        return Err(MimirError::ValidationFailed(
            "Invalid MP4 ftyp box header".into(),
        ));
    }
    Ok(format!("Valid MP4 video ({} bytes)", bytes.len()))
}

fn validate_gif(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() < 14 || (!bytes.starts_with(b"GIF87a") && !bytes.starts_with(b"GIF89a")) {
        return Err(MimirError::ValidationFailed("Invalid GIF header".into()));
    }
    Ok(format!("Valid animated GIF ({} bytes)", bytes.len()))
}

fn validate_wav(bytes: &[u8]) -> std::result::Result<String, MimirError> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(MimirError::ValidationFailed(
            "Invalid WAV RIFF/WAVE PCM header".into(),
        ));
    }
    Ok(format!("Valid RIFF/WAVE audio ({} bytes)", bytes.len()))
}

fn validate_bundle_zip(
    path: &std::path::Path,
    required: &[&str],
    label: &str,
) -> std::result::Result<String, MimirError> {
    let file = std::fs::File::open(path)
        .map_err(|e| MimirError::ValidationFailed(format!("Cannot open bundle: {e}")))?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| MimirError::ValidationFailed(format!("Invalid ZIP bundle: {e}")))?;
    for req in required {
        if archive.by_name(req).is_err() {
            return Err(MimirError::ValidationFailed(format!(
                "{label} missing required entry: {req}"
            )));
        }
    }
    Ok(format!("Valid {label} ({} entries)", archive.len()))
}
