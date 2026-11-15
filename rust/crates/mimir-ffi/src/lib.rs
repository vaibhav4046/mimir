use mimir_security::vault::redact_tokens_and_secrets;

pub fn security_version() -> &'static str {
    concat!("mimir-security/", env!("CARGO_PKG_VERSION"))
}

pub fn redact_text_ffi(input: &str) -> String {
    redact_tokens_and_secrets(input, &[])
}

#[cfg(target_os = "android")]
mod android_jni {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_ai_mimir_companion_MimirNativeBridge_securityVersion<'local>(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
    ) -> jstring {
        match env.new_string(security_version()) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }

    #[no_mangle]
    pub extern "system" fn Java_ai_mimir_companion_MimirNativeBridge_redactText<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        input: JString<'local>,
    ) -> jstring {
        let text: String = match env.get_string(&input) {
            Ok(s) => s.into(),
            Err(_) => return std::ptr::null_mut(),
        };
        let clean = redact_text_ffi(&text);
        match env.new_string(clean) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_tokens_cleanly() {
        let out = redact_text_ffi("token=ghp_1234567890abcdef and sk-abcdef123456");
        assert!(!out.contains("ghp_1234567890abcdef"));
        assert!(!out.contains("sk-abcdef123456"));
    }
}
